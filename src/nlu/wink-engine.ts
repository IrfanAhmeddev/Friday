import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);

export interface LinguisticAnalysis {
  text: string;
  tokens: string[];
  lemmas: string[];
  nouns: string[];
  verbs: string[];
  adjectives: string[];
  adverbs: string[];
  entities: Array<{
    value: string;
    type: string;
  }>;
}

export function analyzeText(text: string): LinguisticAnalysis {
  const doc = nlp.readDoc(text);

  const tokens = doc.tokens().out();

  // winkNLP's TypeScript definitions can have an incompatible
  // generic signature for its.lemma, so use the token output
  // callback with a local type assertion.
  const lemmas = doc.tokens().out(
    nlp.its.lemma as any
  ) as string[];

  const posTags = doc.tokens().out(
    nlp.its.pos as any
  ) as string[];

  const nouns: string[] = [];
  const verbs: string[] = [];
  const adjectives: string[] = [];
  const adverbs: string[] = [];

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
    .out(nlp.its.detail as any) as Array<{
      value: string;
      type: string;
    }>;

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