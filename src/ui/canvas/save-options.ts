// What the project file's "save as" dialog is asked for. In its own file, with no React, so tests can hand the
// very same options to a real browser.

export const PROJECT_EXTENSION = '.node-cms.json';

/**
 * The browser's "save as" dialog takes only simple extensions in its file types: a dot, then letters, digits or
 * "+" (Chromium refuses ".node-cms.json" for its "-"). So the type is ".json"; the suggested name still ends in
 * ".node-cms.json", which also ends in ".json".
 */
export const PROJECT_FILE_TYPES = [{ description: 'Node CMS project', accept: { 'application/json': ['.json'] } }];

export const savePickerOptions = (suggestedName: string) => ({ suggestedName, types: PROJECT_FILE_TYPES });
