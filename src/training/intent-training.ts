export interface TrainingExample {
  intent: string;
  text: string;
  keywords: string[];
}

export const TRAINING_EXAMPLES: TrainingExample[] = [
  // ============================================================
  // CREATE
  // ============================================================

  {
    intent: "workspace.create",
    text: "create a document",
    keywords: ["create", "document"],
  },
  {
    intent: "workspace.create",
    text: "make me a report",
    keywords: ["make", "report"],
  },
  {
    intent: "workspace.create",
    text: "I need a new document",
    keywords: ["new", "document"],
  },
  {
    intent: "workspace.create",
    text: "prepare a fresh report",
    keywords: ["prepare", "fresh", "report"],
  },
  {
    intent: "workspace.create",
    text: "start a document called project report",
    keywords: ["start", "document", "called"],
  },
  {
    intent: "workspace.create",
    text: "create a new spreadsheet",
    keywords: ["create", "new", "spreadsheet"],
  },
  {
    intent: "workspace.create",
    text: "make a sheet for monthly expenses",
    keywords: ["make", "sheet", "expenses"],
  },
  {
    intent: "workspace.create",
    text: "could you create something for my project",
    keywords: ["create", "project"],
  },
  {
    intent: "workspace.create",
    text: "I want a fresh report for college",
    keywords: ["fresh", "report", "college"],
  },
  {
    intent: "workspace.create",
    text: "build a new file for my project",
    keywords: ["build", "new", "file", "project"],
  },
  {
    intent: "workspace.create",
    text: "prepare a document for me",
    keywords: ["prepare", "document"],
  },
  {
    intent: "workspace.create",
    text: "start a new report",
    keywords: ["start", "new", "report"],
  },
  {
    intent: "workspace.create",
    text: "make a new note",
    keywords: ["make", "new", "note"],
  },
  {
    intent: "workspace.create",
    text: "create a presentation",
    keywords: ["create", "presentation"],
  },

  // ============================================================
  // OPEN
  // ============================================================

  {
    intent: "workspace.open",
    text: "open my document",
    keywords: ["open", "document"],
  },
  {
    intent: "workspace.open",
    text: "access my report",
    keywords: ["access", "report"],
  },
  {
    intent: "workspace.open",
    text: "bring up the latest file",
    keywords: ["bring", "latest", "file"],
  },
  {
    intent: "workspace.open",
    text: "can you open that document",
    keywords: ["open", "document"],
  },
  {
    intent: "workspace.open",
    text: "bring up the document",
    keywords: ["bring", "document"],
  },
  {
    intent: "workspace.open",
    text: "bring up the file I worked on",
    keywords: ["bring", "file", "worked"],
  },
  {
    intent: "workspace.open",
    text: "take me to my document",
    keywords: ["take", "document"],
  },
  {
    intent: "workspace.open",
    text: "show me the document I edited yesterday",
    keywords: ["document", "edited", "yesterday"],
  },
  {
    intent: "workspace.open",
    text: "launch my report",
    keywords: ["launch", "report"],
  },
  {
    intent: "workspace.open",
    text: "open the file I worked on yesterday",
    keywords: ["open", "file", "worked", "yesterday"],
  },
  {
    intent: "workspace.open",
    text: "I want to access my latest document",
    keywords: ["access", "latest", "document"],
  },
  {
    intent: "workspace.open",
    text: "go to my spreadsheet",
    keywords: ["go", "spreadsheet"],
  },

  // ============================================================
  // SHOW / LIST
  // ============================================================

  {
    intent: "workspace.show",
    text: "show my documents",
    keywords: ["show", "documents"],
  },
  {
    intent: "workspace.show",
    text: "display all my files",
    keywords: ["display", "files"],
  },
  {
    intent: "workspace.show",
    text: "let me see my notes",
    keywords: ["see", "notes"],
  },
  {
    intent: "workspace.show",
    text: "show all my notes",
    keywords: ["show", "notes"],
  },
  {
    intent: "workspace.show",
    text: "let me see my files",
    keywords: ["see", "files"],
  },
  {
    intent: "workspace.show",
    text: "I want to see everything inside my workspace",
    keywords: ["see", "everything", "workspace"],
  },
  {
    intent: "workspace.show",
    text: "list all my documents",
    keywords: ["list", "documents"],
  },
  {
    intent: "workspace.show",
    text: "show everything in my workspace",
    keywords: ["show", "everything", "workspace"],
  },
  {
    intent: "workspace.show",
    text: "display my spreadsheets",
    keywords: ["display", "spreadsheets"],
  },
  {
    intent: "workspace.show",
    text: "what files do I have",
    keywords: ["files"],
  },

  // ============================================================
  // RENAME
  // ============================================================

  {
    intent: "workspace.rename",
    text: "rename my document",
    keywords: ["rename", "document"],
  },
  {
    intent: "workspace.rename",
    text: "change the name of my report",
    keywords: ["change", "name", "report"],
  },
  {
    intent: "workspace.rename",
    text: "retitle this document",
    keywords: ["retitle", "document"],
  },
  {
    intent: "workspace.rename",
    text: "give this file a different title",
    keywords: ["file", "different", "title"],
  },
  {
    intent: "workspace.rename",
    text: "change the title of this document",
    keywords: ["change", "title", "document"],
  },
  {
    intent: "workspace.rename",
    text: "give my report a new name",
    keywords: ["report", "new", "name"],
  },
  {
    intent: "workspace.rename",
    text: "rename this file",
    keywords: ["rename", "file"],
  },
  {
    intent: "workspace.rename",
    text: "change the title of my report",
    keywords: ["change", "title", "report"],
  },
  {
    intent: "workspace.rename",
    text: "I want to give this document another name",
    keywords: ["document", "another", "name"],
  },
  {
    intent: "workspace.rename",
    text: "update the name of this file",
    keywords: ["update", "name", "file"],
  },

  // ============================================================
  // DELETE
  // ============================================================

  {
    intent: "workspace.delete",
    text: "delete my document",
    keywords: ["delete", "document"],
  },
  {
    intent: "workspace.delete",
    text: "remove the report",
    keywords: ["remove", "report"],
  },
  {
    intent: "workspace.delete",
    text: "erase that file",
    keywords: ["erase", "file"],
  },
  {
    intent: "workspace.delete",
    text: "remove that file",
    keywords: ["remove", "file"],
  },
  {
    intent: "workspace.delete",
    text: "get rid of the old report",
    keywords: ["get", "rid", "old", "report"],
  },
  {
    intent: "workspace.delete",
    text: "delete this spreadsheet",
    keywords: ["delete", "spreadsheet"],
  },
  {
    intent: "workspace.delete",
    text: "I want to remove my document",
    keywords: ["remove", "document"],
  },
  {
    intent: "workspace.delete",
    text: "throw away this file",
    keywords: ["throw", "away", "file"],
  },
  {
    intent: "workspace.delete",
    text: "destroy this document",
    keywords: ["destroy", "document"],
  },

  // ============================================================
  // EDIT / UPDATE
  // ============================================================

  {
    intent: "workspace.edit",
    text: "edit my document",
    keywords: ["edit", "document"],
  },
  {
    intent: "workspace.edit",
    text: "modify the report",
    keywords: ["modify", "report"],
  },
  {
    intent: "workspace.edit",
    text: "change the contents of this file",
    keywords: ["change", "contents", "file"],
  },
  {
    intent: "workspace.edit",
    text: "modify the contents of my document",
    keywords: ["modify", "contents", "document"],
  },
  {
    intent: "workspace.edit",
    text: "I want to update the text inside this document",
    keywords: ["update", "text", "document"],
  },
  {
    intent: "workspace.edit",
    text: "update my document",
    keywords: ["update", "document"],
  },
  {
    intent: "workspace.edit",
    text: "change the text in my report",
    keywords: ["change", "text", "report"],
  },
  {
    intent: "workspace.edit",
    text: "make changes to this file",
    keywords: ["make", "changes", "file"],
  },
  {
    intent: "workspace.edit",
    text: "rewrite the contents of my document",
    keywords: ["rewrite", "contents", "document"],
  },
  {
    intent: "workspace.edit",
    text: "add some text to my document",
    keywords: ["add", "text", "document"],
  },
];