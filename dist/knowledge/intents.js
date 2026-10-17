"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTENTS = void 0;
exports.INTENTS = [
    {
        name: "conversation.greeting",
        examples: [
            "hello",
            "hi",
            "hey",
            "hey friday",
            "hello friday",
            "good morning",
            "good evening"
        ],
        keywords: [
            "hello",
            "hi",
            "hey",
            "morning",
            "evening"
        ]
    },
    {
        name: "workspace.document.open",
        examples: [
            "open my document",
            "open my notes",
            "show my document",
            "show my notes",
            "open the file",
            "bring up my document",
            "let me see my notes"
        ],
        keywords: [
            "open",
            "show",
            "view",
            "display",
            "bring"
        ]
    },
    {
        name: "workspace.document.create",
        examples: [
            "create a document",
            "make a document",
            "create a new document",
            "make a new note",
            "start a new document"
        ],
        keywords: [
            "create",
            "make",
            "start",
            "new"
        ]
    },
    {
        name: "workspace.search",
        examples: [
            "search my workspace",
            "find my document",
            "search for a file",
            "find a document"
        ],
        keywords: [
            "search",
            "find",
            "look"
        ]
    }
];
