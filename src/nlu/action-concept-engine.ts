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
  negated: boolean;
  ambiguous: boolean;
  actionAlternatives: ActionConcept[];
  fuzzy: boolean;
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

const SINGLE_TOKEN_ACTIONS = new Map<string, ActionConcept>(
  ACTION_PATTERNS
    .filter((pattern) => pattern.weight >= 0.8)
    .flatMap((pattern) =>
      pattern.phrases
        .filter((phrase) => phrase.length === 1)
        .map((phrase) => [phrase[0], pattern.action] as const),
    ),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\b(can't)\b/g, "cannot")
    .replace(/\b(won't)\b/g, "will not")
    .replace(/\b(shan't)\b/g, "shall not")
    .replace(/\b(don|doesn|didn|isn|aren|wasn|weren|hasn|haven|hadn|wouldn|shouldn|couldn|mustn)'t\b/g, (_match, stem: string) =>
      `${stem.slice(0, -1)} not`,
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function findPhrase(
  tokens: string[],
  phrase: string[],
): number {
  if (phrase.length > tokens.length) {
    return -1;
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
      return i;
    }
  }

  return -1;
}

function isOneEditOrTranspositionAway(left: string, right: string): boolean {
  if (left === right || Math.abs(left.length - right.length) > 1) {
    return false;
  }
  if (left.length === right.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) mismatches.push(index);
    }
    return mismatches.length === 1 ||
      (mismatches.length === 2 &&
        mismatches[1] === mismatches[0] + 1 &&
        left[mismatches[0]] === right[mismatches[1]] &&
        left[mismatches[1]] === right[mismatches[0]]);
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++;
      longIndex++;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex++;
    }
  }
  return true;
}

function isNegatedAction(tokens: string[], actionStart: number): boolean {
  const preceding = tokens.slice(Math.max(0, actionStart - 4), actionStart);
  let negationIndex = -1;
  for (let index = preceding.length - 1; index >= 0; index--) {
    if (["not", "never", "no", "cannot"].includes(preceding[index])) {
      negationIndex = index;
      break;
    }
  }
  if (negationIndex < 0) {
    return false;
  }
  const scope = preceding.slice(negationIndex + 1);
  return !scope.some((token) =>
    ["only", "just", "but", "however", "instead"].includes(token),
  );
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
      negated: false,
      ambiguous: false,
      actionAlternatives: [],
      fuzzy: false,
    };
  }

  const matches: Array<{
    action: ActionConcept;
    phrase: string[];
    weight: number;
    start: number;
  }> = [];

  for (const pattern of ACTION_PATTERNS) {
    for (const phrase of pattern.phrases) {
      const start = findPhrase(tokens, phrase);
      if (start >= 0) {
        matches.push({
          action: pattern.action,
          phrase,
          weight: pattern.weight,
          start,
        });
      }
    }
  }

  if (matches.length === 0) {
    const fuzzyMatch = tokens
      .map((token, index) => {
        const closest = [...SINGLE_TOKEN_ACTIONS.entries()]
          .find(([phrase]) => isOneEditOrTranspositionAway(token, phrase));
        return closest
          ? { action: closest[1], phrase: closest[0], start: index }
          : null;
      })
      .find((candidate) => candidate !== null);
    if (fuzzyMatch) {
      if (isNegatedAction(tokens, fuzzyMatch.start)) {
        return {
          action: "unknown",
          confidence: 0,
          matchedWords: [],
          matchedPhrase: null,
          negated: true,
          ambiguous: false,
          actionAlternatives: [],
          fuzzy: false,
        };
      }
      return {
        action: fuzzyMatch.action,
        confidence: 0.8,
        matchedWords: [fuzzyMatch.phrase],
        matchedPhrase: fuzzyMatch.phrase,
        negated: false,
        ambiguous: false,
        actionAlternatives: [fuzzyMatch.action],
        fuzzy: true,
      };
    }
    return {
      action: "unknown",
      confidence: 0,
      matchedWords: [],
      matchedPhrase: null,
      negated: false,
      ambiguous: false,
      actionAlternatives: [],
      fuzzy: false,
    };
  }

  matches.sort((a, b) => {
    if (b.phrase.length !== a.phrase.length) {
      return b.phrase.length - a.phrase.length;
    }

    return b.weight - a.weight;
  });

  const bestMatch = matches[0];
  if (isNegatedAction(tokens, bestMatch.start)) {
    return {
      action: "unknown",
      confidence: 0,
      matchedWords: [],
      matchedPhrase: null,
      negated: true,
      ambiguous: false,
      actionAlternatives: [],
      fuzzy: false,
    };
  }
  const actionAlternatives = [
    ...new Set(
      matches
        .filter((match) => match.weight >= 0.8)
        .map((match) => match.action),
    ),
  ];
  if (actionAlternatives.length > 1) {
    return {
      action: "unknown",
      confidence: 0,
      matchedWords: [],
      matchedPhrase: null,
      negated: false,
      ambiguous: true,
      actionAlternatives,
      fuzzy: false,
    };
  }

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
    negated: false,
    ambiguous: false,
    actionAlternatives: [bestMatch.action],
    fuzzy: false,
  };
}