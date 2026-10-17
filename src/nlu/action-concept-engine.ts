export type ActionConcept =
  | "create"
  | "open"
  | "search"
  | "show"
  | "edit"
  | "rename"
  | "delete"
  | "close"
  | "unknown";

export interface ActionConceptResult {
  action: ActionConcept;
  confidence: number;
  matchedWords: string[];
  matchedPhrase: string | null;
}

interface ActionPattern {
  action: ActionConcept;
  phrases: string[][];
  weight: number;
}

const ACTION_PATTERNS: ActionPattern[] = [
  {
    action: "create",
    weight: 1,
    phrases: [
      ["create"],
      ["make"],
      ["build"],
      ["prepare"],
      ["start", "a"],
      ["generate"],
    ],
  },
  {
    action: "create",
    weight: 0.35,
    phrases: [["new"]],
  },
  {
    action: "open",
    weight: 1,
    phrases: [
      ["open"],
      ["access"],
      ["launch"],
      ["enter"],
      ["bring", "up"],
      ["take", "me", "to"],
      ["go", "to"],
      ["load"],
    ],
  },
  {
    action: "search",
    weight: 1.1,
    phrases: [
      ["search"],
      ["find"],
      ["look", "for"],
      ["look", "up"],
      ["lookup"],
      ["locate"],
      ["search", "for"],
    ],
  },
  {
    action: "show",
    weight: 1,
    phrases: [
      ["show"],
      ["display"],
      ["see"],
      ["view"],
      ["list"],
      ["look", "at"],
      ["let", "me", "see"],
      ["what", "do", "i", "have"],
    ],
  },
  {
    action: "edit",
    weight: 1,
    phrases: [
      ["edit"],
      ["modify"],
      ["update"],
      ["change", "the", "contents"],
      ["change", "the", "text"],
      ["add"],
      ["rewrite"],
    ],
  },
  {
    action: "rename",
    weight: 1.2,
    phrases: [
      ["rename"],
      ["retitle"],
      ["change", "the", "name"],
      ["change", "the", "title"],
      ["different", "title"],
      ["new", "name"],
      ["another", "name"],
      ["give", "it", "a", "new", "name"],
    ],
  },
  {
    action: "delete",
    weight: 1,
    phrases: [
      ["delete"],
      ["remove"],
      ["erase"],
      ["destroy"],
      ["get", "rid", "of"],
      ["throw", "away"],
    ],
  },
  {
    action: "close",
    weight: 1,
    phrases: [
      ["close"],
      ["exit"],
      ["leave"],
      ["dismiss"],
    ],
  },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function containsPhrase(
  tokens: string[],
  phrase: string[],
): boolean {
  if (phrase.length > tokens.length) {
    return false;
  }

  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    let matched = true;

    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return true;
    }
  }

  return false;
}

function phraseToText(phrase: string[]): string {
  return phrase.join(" ");
}

export function detectActionConcept(
  text: string,
): ActionConceptResult {
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return {
      action: "unknown",
      confidence: 0,
      matchedWords: [],
      matchedPhrase: null,
    };
  }

  const matches: Array<{
    action: ActionConcept;
    phrase: string[];
    weight: number;
  }> = [];

  for (const pattern of ACTION_PATTERNS) {
    for (const phrase of pattern.phrases) {
      if (containsPhrase(tokens, phrase)) {
        matches.push({
          action: pattern.action,
          phrase,
          weight: pattern.weight,
        });
      }
    }
  }

  if (matches.length === 0) {
    return {
      action: "unknown",
      confidence: 0,
      matchedWords: [],
      matchedPhrase: null,
    };
  }

  matches.sort((a, b) => {
    if (b.phrase.length !== a.phrase.length) {
      return b.phrase.length - a.phrase.length;
    }

    return b.weight - a.weight;
  });

  const bestMatch = matches[0];

  const confidence =
    bestMatch.phrase.length >= 3
      ? 0.98
      : bestMatch.phrase.length === 2
        ? 0.92
        : 0.85;

  return {
    action: bestMatch.action,
    confidence,
    matchedWords: bestMatch.phrase,
    matchedPhrase: phraseToText(bestMatch.phrase),
  };
}