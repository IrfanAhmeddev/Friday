import nlp from "compromise";

export interface TokenizedText {
  text: string;
  terms: string[];
  nouns: string[];
  verbs: string[];
}

export function tokenize(text: string): TokenizedText {
  const doc = nlp(text);

  return {
    text,
    terms: doc.terms().out("array"),
    nouns: doc.nouns().out("array"),
    verbs: doc.verbs().out("array")
  };
}