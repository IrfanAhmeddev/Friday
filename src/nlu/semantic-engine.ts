
export type SemanticAction =
  | "create"
  | "open"
  | "search"
  | "show"
  | "delete"
  | "remove"
  | "rename"
  | "close"
  | "unknown";

export type SemanticObject =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "note"
  | "file"
  | "folder"
  | "application"
  | "unknown";

export interface SemanticMeaning {
  action: SemanticAction;
  object: SemanticObject;
  confidence: number;
  matchedWords: string[];
}

interface ActionDefinition {
  action: SemanticAction;
  words: string[];
}

interface ObjectDefinition {
  object: SemanticObject;
  words: string[];
}

const ACTIONS: ActionDefinition[] = [
  {
    action: "create",
    words: [
      "create",
      "make",
      "start",
      "build"
    ]
  },
  {
    action: "open",
    words: [
      "open",
      "access",
      "launch",
      "enter"
    ]
  },
  {
    action: "search",
    words: [
      "search",
      "find",
      "look",
      "lookup"
    ]
  },
  {
    action: "show",
    words: [
      "show",
      "display",
      "view",
      "see"
    ]
  },
  {
    action: "delete",
    words: [
      "delete",
      "erase",
      "destroy"
    ]
  },
  {
    action: "remove",
    words: [
      "remove"
    ]
  },
  {
    action: "rename",
    words: [
      "rename",
      "retitle"
    ]
  },
  {
    action: "close",
    words: [
      "close",
      "exit"
    ]
  }
];

const OBJECTS: ObjectDefinition[] = [
  {
    object: "document",
    words: [
      "document",
      "documents",
      "doc",
      "docs"
    ]
  },
  {
    object: "spreadsheet",
    words: [
      "spreadsheet",
      "spreadsheets",
      "sheet",
      "sheets"
    ]
  },
  {
    object: "presentation",
    words: [
      "presentation",
      "presentations",
      "slide",
      "slides",
      "deck"
    ]
  },
  {
    object: "note",
    words: [
      "note",
      "notes"
    ]
  },
  {
    object: "file",
    words: [
      "file",
      "files"
    ]
  },
  {
    object: "folder",
    words: [
      "folder",
      "folders",
      "directory",
      "directories"
    ]
  },
  {
    object: "application",
    words: [
      "application",
      "app",
      "apps",
      "program"
    ]
  }
];

function tokenize(
  text: string
): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word.replace(/[^\w]/g, "")
    )
    .filter(Boolean);
}

/*
 * Damerau-Levenshtein distance.
 *
 * Unlike normal Levenshtein distance, this also
 * understands adjacent character transpositions.
 *
 * Example:
 *
 * open
 * opne
 *
 * The n/e characters were swapped.
 *
 * Damerau-Levenshtein distance = 1
 */
function damerauLevenshteinDistance(
  a: string,
  b: string
): number {
  const matrix: number[][] = [];

  const rows = b.length + 1;
  const columns = a.length + 1;

  for (let i = 0; i < rows; i++) {
    matrix[i] = [];

    for (let j = 0; j < columns; j++) {
      matrix[i][j] = 0;
    }
  }

  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }

  for (let j = 0; j < columns; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const cost =
        b[i - 1] === a[j - 1]
          ? 0
          : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );

      /*
       * Adjacent transposition.
       *
       * Example:
       *
       * open
       * opne
       */
      if (
        i > 1 &&
        j > 1 &&
        b[i - 1] === a[j - 2] &&
        b[i - 2] === a[j - 1]
      ) {
        matrix[i][j] = Math.min(
          matrix[i][j],
          matrix[i - 2][j - 2] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/*
 * Fuzzy action matching.
 *
 * We intentionally keep this conservative.
 *
 * Short words:
 *   maximum distance = 1
 *
 * Longer words:
 *   maximum distance = 2
 *
 * This catches:
 *
 * opne   -> open
 * shwo   -> show
 * delte  -> delete
 * cretae -> create
 *
 * without allowing arbitrary words to become
 * commands.
 */
function fuzzyActionMatch(
  token: string,
  words: string[]
): {
  word: string;
  distance: number;
} | null {
  let bestMatch: {
    word: string;
    distance: number;
  } | null = null;

  for (const word of words) {
    const distance =
      damerauLevenshteinDistance(
        token,
        word
      );

    const maxDistance =
      word.length >= 5
        ? 2
        : 1;

    if (
      distance <= maxDistance &&
      (
        bestMatch === null ||
        distance < bestMatch.distance
      )
    ) {
      bestMatch = {
        word,
        distance
      };
    }
  }

  return bestMatch;
}

function detectAction(
  tokens: string[]
): {
  action: SemanticAction;
  matchedWords: string[];
  fuzzy: boolean;
  fuzzyDistance: number;
} {
  /*
   * -----------------------------------------
   * PASS 1
   * EXACT MATCH
   * -----------------------------------------
   */
  for (const definition of ACTIONS) {
    const matchedWords =
      tokens.filter(
        (token) =>
          definition.words.includes(
            token
          )
      );

    if (matchedWords.length > 0) {
      return {
        action:
          definition.action,

        matchedWords,

        fuzzy: false,

        fuzzyDistance: 0
      };
    }
  }

  /*
   * -----------------------------------------
   * PASS 2
   * FUZZY MATCH
   * -----------------------------------------
   */
  let bestAction:
    SemanticAction = "unknown";

  let bestWord: string | null =
    null;

  let bestDistance = Infinity;

  for (const definition of ACTIONS) {
    for (const token of tokens) {
      const match =
        fuzzyActionMatch(
          token,
          definition.words
        );

      if (
        match &&
        match.distance < bestDistance
      ) {
        bestAction =
          definition.action;

        bestWord = token;

        bestDistance =
          match.distance;
      }
    }
  }

  if (
    bestAction !== "unknown" &&
    bestWord !== null
  ) {
    return {
      action:
        bestAction,

      matchedWords: [
        bestWord
      ],

      fuzzy: true,

      fuzzyDistance:
        bestDistance
    };
  }

  return {
    action: "unknown",

    matchedWords: [],

    fuzzy: false,

    fuzzyDistance: 0
  };
}

function detectObject(
  tokens: string[]
): SemanticObject {
  for (const definition of OBJECTS) {
    const matched =
      tokens.some(
        (token) =>
          definition.words.includes(
            token
          )
      );

    if (matched) {
      return definition.object;
    }
  }

  return "unknown";
}

export function detectSemanticAction(
  text: string
): SemanticMeaning {
  const tokens =
    tokenize(text);

  if (tokens.length === 0) {
    return {
      action: "unknown",
      object: "unknown",
      confidence: 0,
      matchedWords: []
    };
  }

  const actionResult =
    detectAction(tokens);

  const object =
    detectObject(tokens);

  if (
    actionResult.action ===
    "unknown"
  ) {
    return {
      action: "unknown",
      object,
      confidence: 0,
      matchedWords: []
    };
  }

  /*
   * -----------------------------------------
   * CONFIDENCE
   * -----------------------------------------
   *
   * Exact:
   *
   * action only       = 0.70
   * action + object   = 0.90
   *
   * Fuzzy:
   *
   * action only       = 0.55
   * action + object   = 0.75
   *
   * The lower confidence tells JARVIS Core
   * that the action was inferred rather than
   * explicitly matched.
   */

  let confidence =
    actionResult.fuzzy
      ? 0.55
      : 0.70;

  if (object !== "unknown") {
    confidence += 0.20;
  }

  if (
    actionResult.matchedWords
      .length > 1
  ) {
    confidence += 0.05;
  }

  confidence =
    Math.min(
      confidence,
      actionResult.fuzzy
        ? 0.85
        : 0.95
    );

  return {
    action:
      actionResult.action,

    object,

    confidence:
      Number(
        confidence.toFixed(3)
      ),

    matchedWords:
      actionResult.matchedWords
  };
}
