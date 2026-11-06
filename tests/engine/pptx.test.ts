import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildTextIndex, GraphEvaluator, importPptx, importSource, nodeRegistry, parseSlideRange, runSelector, serialize, storeFile,
} from '../../src/engine';
import { PNG_BASE64, SAMPLE_DECK } from '../../src/samples';
import { fixture } from './helpers';

const sample = () => new Uint8Array(fixture('sample.pptx'));

// ---------------------------------------------------------------------------------------------
// Hand-made decks, for structures pptxgenjs does not write.

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

interface FakeSlide {
  file: string;
  shapes: string;
  hidden?: boolean;
  notes?: string;
  layout?: string;
  links?: Record<string, string>;
}

const sp = (opts: { ph?: string; idx?: string; x?: number; y?: number; paras: string }) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${opts.ph || opts.idx ? `<p:ph${opts.ph ? ` type="${opts.ph}"` : ''}${opts.idx ? ` idx="${opts.idx}"` : ''}/>` : ''}</p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="${opts.x ?? 0}" y="${opts.y ?? 0}"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>${opts.paras}</p:txBody></p:sp>`;
const para = (text: string, pPr = '', rPr = '') => `<a:p>${pPr ? `<a:pPr ${pPr}/>` : ''}<a:r><a:rPr lang="en-US" ${rPr}/><a:t>${text}</a:t></a:r></a:p>`;

async function makeDeck(slides: FakeSlide[], order = slides.map((_, i) => i)): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation ${P}><p:sldIdLst>${order.map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides
      .map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/${s.file}"/>`)
      .join('')}</Relationships>`,
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<p:sldLayout ${P}><p:cSld name="Title and Content"><p:spTree>${sp({ ph: 'title', idx: '0', paras: '' })}${sp({ idx: '1', paras: '' })}${sp({ ph: 'ftr', idx: '11', paras: '' })}</p:spTree></p:cSld></p:sldLayout>`,
  );
  slides.forEach((s, i) => {
    zip.file(`ppt/slides/${s.file}`, `<p:sld ${P}${s.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${s.shapes}</p:spTree></p:cSld></p:sld>`);
    const rels = [`<Relationship Id="rL" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    if (s.notes) {
      rels.push(`<Relationship Id="rN" Type="${REL}/notesSlide" Target="../notesSlides/notes${i}.xml"/>`);
      zip.file(
        `ppt/notesSlides/notes${i}.xml`,
        `<p:notes ${P}><p:cSld><p:spTree>${sp({ ph: 'sldImg', paras: '' })}${sp({ ph: 'body', idx: '1', paras: para(s.notes) })}${sp({ ph: 'sldNum', idx: '5', paras: para('7') })}</p:spTree></p:cSld></p:notes>`,
      );
    }
    for (const [id, url] of Object.entries(s.links ?? {})) rels.push(`<Relationship Id="${id}" Type="${REL}/hyperlink" Target="${url}" TargetMode="External"/>`);
    zip.file(`ppt/slides/_rels/${s.file}.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  });
  return zip.generateAsync({ type: 'uint8array' });
}

// ---------------------------------------------------------------------------------------------

describe('importing the sample deck', () => {
  it('makes one section per slide, in the deck order, leaving out the hidden slide', async () => {
    const doc = await importPptx(sample(), { fileName: 'sample.pptx' });
    const sections = doc.tree.children.filter((n) => n.type === 'element' && n.tagName === 'section');
    expect(doc.meta.origin).toBe('pptx');
    expect(doc.meta.pptx?.slideCount).toBe(SAMPLE_DECK.slides.length + 4);
    expect(sections.map((s) => (s as { properties: { dataSlide?: string } }).properties.dataSlide)).toEqual(
      ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    );
    expect(doc.meta.pptx?.slides.find((s) => s.number === 6)).toMatchObject({ title: 'Hidden extra', hidden: true, included: false });
    expect(doc.meta.title).toBe(SAMPLE_DECK.title);
    expect(doc.meta.warnings).toEqual(['Slide 15: a chart is shown as a table of its data']);
  });

  it('brings tables (with merged cells), linked pictures and charts', async () => {
    const doc = await importPptx(sample());
    const html = serialize(doc);
    expect(html).toContain('<tr><td><strong>Node</strong></td><td><strong>Input</strong></td><td><strong>Output</strong></td></tr>');
    expect(html).toContain('<tr><td colspan="3">Everything else</td></tr>');
    const [id] = Object.keys(doc.assets);
    expect(id).toMatch(/^pptx-/);
    expect(doc.assets[id]).toMatchObject({ contentType: 'image/png', base64: PNG_BASE64 });
    expect(html).toContain(`<figure class="slide-picture"><a href="https://example.com/"><img src="asset:${id}" alt="Logo" width="192"></a></figure>`);
    expect(html).toContain(
      '<figure class="slide-chart"><table><thead><tr><th></th><th>Gardens</th></tr></thead><tbody><tr><th>2024</th><td>3</td></tr><tr><th>2025</th><td>7</td></tr><tr><th>2026</th><td>12</td></tr></tbody></table><figcaption>Growth</figcaption></figure>',
    );
    // The picture works in the exported page.
    expect(serialize(doc, { fullDocument: true, inlineAssets: true })).toContain(`src="data:image/png;base64,${PNG_BASE64}"`);
  });

  it('turns titles into headings, bullets into nested lists and numbered bullets into <ol>', async () => {
    const html = serialize(await importPptx(sample()));
    expect(html).toContain('<h2>Getting started</h2><ul><li>Plant a source node first</li><li>Then connect a selector to it</li></ul>');
    expect(html).toContain('<ul><li>Sources<ul><li>HTML, Word and JSON<ul><li>And now PowerPoint</li></ul></li></ul></li><li>Selectors</li></ul>');
    expect(html).toContain('<ol><li>Upload a document</li><li>Select some text</li><li>Apply a snippet</li></ol>');
    expect(html).toContain('<p><strong>More: </strong><a href="https://example.com/docs">Read the docs</a></p>');
  });

  it('adds speaker notes, or leaves them out', async () => {
    const withNotes = serialize(await importPptx(sample()));
    expect(withNotes).toContain('<aside class="speaker-notes"><p>Talk about pricing.</p></aside>');
    expect(serialize(await importPptx(sample(), { includeNotes: false }))).not.toContain('speaker-notes');
  });

  it('includes hidden slides and picks slide ranges on request', async () => {
    const hidden = await importPptx(sample(), { includeHidden: true });
    expect(serialize(hidden)).toContain('<section class="slide" data-slide="6" data-layout');
    const some = await importPptx(sample(), { slides: '2-3, 12, 6' });
    expect(some.meta.pptx?.slides.filter((s) => s.included).map((s) => s.number)).toEqual([2, 3, 12]); // 6 is hidden
  });

  it('measures text block by block, like any document', async () => {
    const text = buildTextIndex((await importPptx(sample())).tree).text;
    expect(text.startsWith(`${SAMPLE_DECK.title}\n${SAMPLE_DECK.subtitle}\nGetting started\n`)).toBe(true);
  });

  it('comes in through importSource and the Document Source node', async () => {
    const viaSource = await importSource({ name: 'deck.pptx', data: sample() }, { pptx: { includeNotes: false } });
    expect(serialize(viaSource)).not.toContain('speaker-notes');
    await expect(importSource({ name: 'deck.pptx', data: 'text' })).rejects.toThrow(/binary/);

    const file = storeFile('deck.pptx', sample(), 'deck');
    const graph = {
      nodes: [
        { id: 'src', type: 'documentSource', config: { fileId: 'deck', pptx: { slides: '1-4' } } },
        { id: 'sel', type: 'selector', config: { mode: 'css', selector: 'section.slide h2' } },
      ],
      edges: [{ id: 'e', source: 'src', sourcePort: 'document', target: 'sel', targetPort: 'document' }],
    };
    const { results } = await new GraphEvaluator(nodeRegistry).evaluate(graph, { files: { deck: file } });
    expect(results.src.info).toMatchObject({ file: 'deck.pptx', format: 'pptx', slides: 4, slideCount: 15, hiddenSlides: 1 });
    expect(results.sel.info.matches).toBe(4); // the sample's first slide uses a plain title, so <h2>
    // Heading sections work too: a slide title selects its slide's content.
    const section = runSelector(results.src.outputs.document as never, { mode: 'heading', text: 'Pricing' });
    expect(section.matches[0].text).toContain('The pro plan adds snippets');
  });
});

describe('importing hand-made decks', () => {
  it('follows the deck order, not the file names', async () => {
    const deck = await makeDeck(
      [
        { file: 'slide1.xml', shapes: sp({ ph: 'title', paras: para('One') }) },
        { file: 'slide2.xml', shapes: sp({ ph: 'title', paras: para('Two') }) },
        { file: 'slide10.xml', shapes: sp({ ph: 'title', paras: para('Ten') }) },
      ],
      [2, 0, 1],
    );
    const doc = await importPptx(deck);
    expect(doc.meta.pptx?.slides.map((s) => s.title)).toEqual(['Ten', 'One', 'Two']);
  });

  it('reads placeholder types from the layout, centred titles as <h1>, and skips footers', async () => {
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes: sp({ ph: 'ctrTitle', paras: para('Welcome') }) + sp({ ph: 'subTitle', y: 10, paras: para('Subtitle here') }),
      },
      {
        file: 'slide2.xml',
        shapes:
          sp({ idx: '1', y: 50, paras: para('Inherited bullet') + para('Plain', '', '') }) +
          sp({ idx: '0', y: 0, paras: para('From the layout') }) +
          sp({ idx: '11', paras: para('Footer text') }),
      },
    ]);
    const html = serialize(await importPptx(deck));
    expect(html).toContain('<h1>Welcome</h1><p class="subtitle">Subtitle here</p>');
    // idx 0 is the layout's title: it comes first although it is listed second.
    expect(html).toContain('<h2>From the layout</h2><ul><li>Inherited bullet</li><li>Plain</li></ul>');
    expect(html).not.toContain('Footer text');
  });

  it('orders other shapes top to bottom, then left to right, and reads groups', async () => {
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes:
          sp({ x: 500, y: 300, paras: para('Bottom right') }) +
          `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr/>${sp({ x: 0, y: 300, paras: para('Bottom left') })}${sp({ x: 0, y: 100, paras: para('Top') })}</p:grpSp>`,
      },
    ]);
    const text = buildTextIndex((await importPptx(deck)).tree).text;
    expect(text).toBe('Top\nBottom left\nBottom right');
  });

  it('keeps formatting and web links; drops links to other slides', async () => {
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        links: { rW: 'https://example.com/a?x=1&y=2', rJ: 'javascript:alert(1)' },
        shapes: sp({
          paras:
            '<a:p><a:r><a:rPr b="1" i="1"/><a:t>Both</a:t></a:r><a:r><a:rPr u="sng"/><a:t> under</a:t></a:r><a:br/>' +
            '<a:r><a:rPr><a:hlinkClick r:id="rW"/></a:rPr><a:t>web</a:t></a:r><a:r><a:rPr><a:hlinkClick r:id="rJ"/></a:rPr><a:t> bad</a:t></a:r>' +
            '<a:r><a:rPr baseline="30000"/><a:t>2</a:t></a:r><a:r><a:t> &lt;tag&gt;</a:t></a:r></a:p>',
        }),
      },
    ]);
    const html = serialize(await importPptx(deck));
    expect(html).toContain('<strong><em>Both</em></strong><u> under</u><br><a href="https://example.com/a?x=1&#x26;y=2">web</a> bad<sup>2</sup> &#x3C;tag>');
  });

  it('mixes bullet kinds and levels into well-formed lists', async () => {
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes: sp({
          paras:
            para('Intro') +
            '<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>a</a:t></a:r></a:p>' +
            '<a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>one</a:t></a:r></a:p>' +
            '<a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>two</a:t></a:r></a:p>' +
            '<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>' +
            para('Outro'),
        }),
      },
    ]);
    const html = serialize(await importPptx(deck));
    expect(html).toContain('<p>Intro</p><ul><li>a<ol><li>one</li><li>two</li></ol></li><li>b</li></ul><p>Outro</p>');
  });

  it('adds notes from the notes body only', async () => {
    const deck = await makeDeck([{ file: 'slide1.xml', shapes: sp({ ph: 'title', paras: para('T') }), notes: 'Say hello' }]);
    expect(serialize(await importPptx(deck))).toContain('<h2>T</h2><aside class="speaker-notes"><p>Say hello</p></aside>');
  });

  it('reads table headers, row spans and lists in cells', async () => {
    const tc = (inner: string, extra = '') => `<a:tc${extra}><a:txBody><a:bodyPr/>${inner}</a:txBody></a:tc>`;
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes:
          '<p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="0" y="0"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>' +
          `<a:tr>${tc(para('Name'))}${tc(para('Notes'), ' gridSpan="2"')}${tc('', ' hMerge="1"')}</a:tr>` +
          `<a:tr>${tc(para('Tall'), ' rowSpan="2"')}${tc(para('a') + para('b'))}${tc('<a:p><a:pPr><a:buChar char="•"/></a:pPr><a:r><a:t>x</a:t></a:r></a:p>')}</a:tr>` +
          `<a:tr>${tc('', ' vMerge="1"')}${tc(para('c'))}${tc(para('d'))}</a:tr>` +
          '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>',
      },
    ]);
    expect(serialize(await importPptx(deck))).toContain(
      '<table><thead><tr><th>Name</th><th colspan="2">Notes</th></tr></thead><tbody>' +
        '<tr><td rowspan="2">Tall</td><td><p>a</p><p>b</p></td><td><ul><li>x</li></ul></td></tr><tr><td>c</td><td>d</td></tr></tbody></table>',
    );
  });

  it('shows SmartArt as a nested list of its text', async () => {
    const pt = (id: string, text?: string, type?: string) =>
      `<dgm:pt modelId="${id}"${type ? ` type="${type}"` : ''}>${text ? `<dgm:t><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></dgm:t>` : ''}</dgm:pt>`;
    const cxn = (src: string, dest: string, ord: number, type?: string) => `<dgm:cxn modelId="c${src}${dest}" srcId="${src}" destId="${dest}" srcOrd="${ord}"${type ? ` type="${type}"` : ''}/>`;
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes:
          '<p:graphicFrame><p:nvGraphicFramePr/><p:xfrm><a:off x="0" y="0"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rD"/></a:graphicData></a:graphic></p:graphicFrame>',
        links: {},
      },
    ]);
    const zip = await JSZip.loadAsync(deck);
    zip.file(
      'ppt/diagrams/data1.xml',
      `<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>${pt('0', undefined, 'doc')}${pt('2', 'Second')}${pt('1', 'First')}${pt('3', 'Child')}${pt('9', 'hidden', 'pres')}</dgm:ptLst><dgm:cxnLst>${cxn('0', '2', 1)}${cxn('0', '1', 0)}${cxn('1', '3', 0)}${cxn('0', '9', 2, 'presOf')}</dgm:cxnLst></dgm:dataModel>`,
    );
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    zip.file('ppt/slides/_rels/slide1.xml.rels', rels.replace('</Relationships>', `<Relationship Id="rD" Type="${REL}/diagramData" Target="../diagrams/data1.xml"/></Relationships>`));
    const doc = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    expect(serialize(doc)).toContain('<div class="slide-smartart"><ul><li>First<ul><li>Child</li></ul></li><li>Second</li></ul></div>');
    expect(doc.meta.warnings).toEqual(['Slide 1: SmartArt is shown as a list of its text']);
  });

  it('explains what it leaves out: videos, unsupported picture types, missing files, other objects', async () => {
    const pic = (embed: string, nvPr = '') =>
      `<p:pic><p:nvPicPr><p:cNvPr id="3" name="p"/><p:cNvPicPr/><p:nvPr>${nvPr}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${embed}"/></p:blipFill><p:spPr/></p:pic>`;
    const deck = await makeDeck([
      {
        file: 'slide1.xml',
        shapes:
          pic('rE') + pic('rM') + pic('rV', '<a:videoFile r:link="rV"/>') + pic('rX') +
          '<p:graphicFrame><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole"/></a:graphic></p:graphicFrame>',
      },
    ]);
    const zip = await JSZip.loadAsync(deck);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      rels.replace(
        '</Relationships>',
        `<Relationship Id="rE" Type="${REL}/image" Target="../media/a.emf"/><Relationship Id="rM" Type="${REL}/image" Target="../media/missing.png"/><Relationship Id="rX" Type="${REL}/image" Target="https://example.com/x.png" TargetMode="External"/></Relationships>`,
      ),
    );
    zip.file('ppt/media/a.emf', new Uint8Array([1, 2, 3]));
    const doc = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    expect(doc.meta.warnings).toEqual([
      'Slide 1: a .emf picture was left out (browsers cannot show EMF images)',
      "Slide 1: a picture's file is missing from the deck",
      'Slide 1: a video is not imported yet',
      'Slide 1: a picture linked from outside the file was left out',
      'Slide 1: an embedded object was left out',
    ]);
    expect(Object.keys(doc.assets)).toEqual([]);
  });

  it('stores a picture used twice once, and puts picture placeholders after the title', async () => {
    const pic = (y: number, ph = '') =>
      `<p:pic><p:nvPicPr><p:cNvPr id="3" name="p" descr="Dot"/><p:cNvPicPr/><p:nvPr>${ph}</p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rP"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="${y}"/><a:ext cx="95250" cy="95250"/></a:xfrm></p:spPr></p:pic>`;
    const deck = await makeDeck([
      { file: 'slide1.xml', shapes: sp({ x: 0, y: 10, paras: para('Text box first') }) + pic(500, '<p:ph type="pic" idx="1"/>') + sp({ ph: 'title', y: 900, paras: para('Title') }) + pic(20) },
    ]);
    const zip = await JSZip.loadAsync(deck);
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
    zip.file('ppt/slides/_rels/slide1.xml.rels', rels.replace('</Relationships>', `<Relationship Id="rP" Type="${REL}/image" Target="../media/dot.png"/></Relationships>`));
    zip.file('ppt/media/dot.png', Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0)));
    const doc = await importPptx(await zip.generateAsync({ type: 'uint8array' }));
    expect(Object.keys(doc.assets)).toHaveLength(1);
    const html = serialize(doc);
    const img = '<figure class="slide-picture"><img src="asset:' + Object.keys(doc.assets)[0] + '" alt="Dot" width="10"></figure>';
    expect(html).toBe(`<section class="slide" data-slide="1" data-layout="Title and Content"><h2>Title</h2>${img}<p>Text box first</p>${img}</section>`);
  });

  it('explains old .ppt files, password-protected files and files that are not decks', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(importPptx(ole, { fileName: 'old.ppt' })).rejects.toThrow(/older PowerPoint file \(\.ppt\) or is password protected/);
    await expect(importPptx(new TextEncoder().encode('hello'), { fileName: 'x.pptx' })).rejects.toThrow(/not a valid \.pptx file/);
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    await expect(importPptx(await zip.generateAsync({ type: 'uint8array' }), { fileName: 'x.pptx' })).rejects.toThrow(/no presentation part/);
  });
});

describe('slide ranges', () => {
  it('reads numbers and ranges', () => {
    expect([...parseSlideRange('1-3, 5;7 9–8', 10).slides!]).toEqual([1, 2, 3, 5, 7, 8, 9]);
    expect(parseSlideRange('', 10).slides).toBeUndefined();
  });

  it('warns about parts it cannot use', () => {
    expect(parseSlideRange('2-x', 5).warnings).toEqual(['"2-x" is not a slide number or range (e.g. 2-5)']);
    expect(parseSlideRange('4-9', 5)).toMatchObject({ warnings: ['The deck has 5 slides: "4-9" goes beyond that'] });
    expect([...parseSlideRange('4-9', 5).slides!]).toEqual([4, 5]);
  });
});
