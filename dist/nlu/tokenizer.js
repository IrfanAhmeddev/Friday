"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenize = tokenize;
const compromise_1 = __importDefault(require("compromise"));
function tokenize(text) {
    const doc = (0, compromise_1.default)(text);
    return {
        text,
        terms: doc.terms().out("array"),
        nouns: doc.nouns().out("array"),
        verbs: doc.verbs().out("array")
    };
}
