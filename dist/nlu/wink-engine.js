"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeText = analyzeText;
const wink_nlp_1 = __importDefault(require("wink-nlp"));
const wink_eng_lite_web_model_1 = __importDefault(require("wink-eng-lite-web-model"));
const nlp = (0, wink_nlp_1.default)(wink_eng_lite_web_model_1.default);
function analyzeText(text) {
    const doc = nlp.readDoc(text);
    const tokens = doc.tokens().out();
    // winkNLP's TypeScript definitions can have an incompatible
    // generic signature for its.lemma, so use the token output
    // callback with a local type assertion.
    const lemmas = doc.tokens().out(nlp.its.lemma);
    const posTags = doc.tokens().out(nlp.its.pos);
    const nouns = [];
    const verbs = [];
    const adjectives = [];
    const adverbs = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const pos = posTags[i];
        if (pos === "NOUN" || pos === "PROPN") {
            nouns.push(token);
        }
        if (pos === "VERB" || pos === "AUX") {
            verbs.push(token);
        }
        if (pos === "ADJ") {
            adjectives.push(token);
        }
        if (pos === "ADV") {
            adverbs.push(token);
        }
    }
    const entityDetails = doc
        .entities()
        .out(nlp.its.detail);
    return {
        text,
        tokens,
        lemmas,
        nouns,
        verbs,
        adjectives,
        adverbs,
        entities: entityDetails
    };
}
