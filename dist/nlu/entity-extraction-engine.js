"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractWorkspaceObject = extractWorkspaceObject;
const OBJECT_PATTERNS = [
    {
        object: "document",
        patterns: [
            "document",
            "documents",
            "doc",
            "docs",
        ],
        confidence: 0.98,
    },
    {
        object: "spreadsheet",
        patterns: [
            "spreadsheet",
            "spreadsheets",
            "sheet",
            "sheets",
        ],
        confidence: 0.98,
    },
    {
        object: "presentation",
        patterns: [
            "presentation",
            "presentations",
            "slide",
            "slides",
            "deck",
        ],
        confidence: 0.98,
    },
    {
        object: "note",
        patterns: [
            "note",
            "notes",
        ],
        confidence: 0.98,
    },
    {
        object: "report",
        patterns: [
            "report",
            "reports",
        ],
        confidence: 0.95,
    },
    {
        object: "file",
        patterns: [
            "file",
            "files",
        ],
        confidence: 0.95,
    },
    {
        object: "project",
        patterns: [
            "project",
            "projects",
        ],
        confidence: 0.95,
    },
];
function extractWorkspaceObject(text) {
    const normalizedText = text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    for (const objectPattern of OBJECT_PATTERNS) {
        for (const pattern of objectPattern.patterns) {
            const patternRegex = new RegExp(`\\b${pattern}\\b`, "i");
            if (patternRegex.test(normalizedText)) {
                return {
                    workspaceObject: objectPattern.object,
                    matchedText: pattern,
                    confidence: objectPattern.confidence,
                };
            }
        }
    }
    return {
        workspaceObject: "unknown",
        matchedText: null,
        confidence: 0,
    };
}
