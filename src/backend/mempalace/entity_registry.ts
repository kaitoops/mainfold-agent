/**
 * entity_registry.ts — Entity registry + detection for MemPalace.
 *
 * Merges logic from:
 *   - nous_reference/entity_registry.py — registry, lookup, disambiguation
 *   - nous_reference/entity_detector.py — candidate extraction, scoring, classification
 *
 * Drop: Wikipedia API calls (not relevant for Chinese user)
 * Keep: Context pattern matching, frequency-based detection, disambiguation
 */

// ── Types ──

export interface PersonInfo {
  source: 'onboarding' | 'learned' | 'wiki';
  contexts: string[];
  aliases: string[];
  relationship: string;
  confidence: number;
  canonical?: string;
  seenCount?: number;
}

export interface LookupResult {
  type: 'person' | 'project' | 'concept' | 'unknown';
  confidence: number;
  source: 'onboarding' | 'learned' | 'wiki' | 'inferred' | 'none' | 'context_disambiguated';
  name: string;
  needsDisambiguation: boolean;
  context?: string[];
  disambiguatedBy?: string;
}

export interface EntityCandidate {
  name: string;
  type: 'person' | 'project' | 'uncertain';
  confidence: number;
  frequency: number;
  signals: EntitySignals;
}

export interface EntitySignals {
  personVerbScore: number;
  pronounProximity: number;
  dialogueScore: number;
  projectVerbScore: number;
  capitalRatio: number;
  wordCount: number;
}

// ── Common English words ambiguous with names ──

const COMMON_ENGLISH_WORDS = new Set([
  'ever', 'grace', 'will', 'bill', 'mark', 'april', 'may', 'june',
  'joy', 'hope', 'faith', 'chance', 'chase', 'hunter', 'dash', 'flash',
  'star', 'sky', 'river', 'brook', 'lane', 'art', 'clay', 'gil', 'nat',
  'max', 'rex', 'ray', 'jay', 'rose', 'violet', 'lily', 'ivy', 'ash',
  'reed', 'sage', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

// ── Context patterns for name disambiguation (from entity_registry.py) ──

const PERSON_CONTEXT_PATTERNS = [
  (name: string) => new RegExp(`\\b${escapeRegex(name)}\\s+(?:said|told|asked|laughed|smiled|was|is|called|texted)\\b`, 'i'),
  (name: string) => new RegExp(`\\b(?:with|saw|called|took)\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`\\b${escapeRegex(name)}(?:'s|s')\\b`, 'i'),
  (name: string) => new RegExp(`\\b(?:hey|thanks?)\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`^${escapeRegex(name)}[\\s:]`, 'im'),
  (name: string) => new RegExp(`\\bmy\\s+(?:son|daughter|kid|child|brother|sister|friend|partner|colleague)\\s+${escapeRegex(name)}\\b`, 'i'),
];

const CONCEPT_CONTEXT_PATTERNS = [
  (name: string) => new RegExp(`\\b(?:have\\s+you|if\\s+you|would|could|will)\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`\\b${escapeRegex(name)}\\s+(?:since|again|more)\\b`, 'i'),
  (name: string) => new RegExp(`\\bnot\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`(?:the\\s+)?${escapeRegex(name)}\\s+(?:of|in|at|for|to)\\b`, 'i'),
];

// ── Person / Project signal patterns (from entity_detector.py) ──

const PERSON_VERB_PATTERNS = [
  (name: string) => new RegExp(`\\b${escapeRegex(name)}\\s+(?:said|asked|told|replied|laughed|smiled|cried|felt|thinks?|wants?|loves?|hates?|knows?|decided|pushed|wrote)\\b`, 'i'),
  (name: string) => new RegExp(`\\b(?:hey|thanks?|hi|dear)\\s+${escapeRegex(name)}\\b`, 'i'),
];

const PROJECT_VERB_PATTERNS = [
  (name: string) => new RegExp(`\\bbuilding\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`\\bship(?:ping|ped)?\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`\\blaunch(?:ing|ed)?\\s+${escapeRegex(name)}\\b`, 'i'),
  (name: string) => new RegExp(`\\bthe\\s+${escapeRegex(name)}\\s+(?:architecture|pipeline|system|repo)\\b`, 'i'),
  (name: string) => new RegExp(`\\b${escapeRegex(name)}\\s+v\\d+\\b`, 'i'),
  (name: string) => new RegExp(`\\b${escapeRegex(name)}\\.py\\b`, 'i'),
  (name: string) => new RegExp(`\\bimport\\s+${escapeRegex(name)}\\b`, 'i'),
];

const DIALOGUE_PATTERNS = [
  (name: string) => new RegExp(`^>\\s*${escapeRegex(name)}[\\s:]`, 'im'),
  (name: string) => new RegExp(`^${escapeRegex(name)}:\\s`, 'im'),
  (name: string) => new RegExp(`^\\[${escapeRegex(name)}\\]`, 'im'),
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'we', 'our', 'you', 'your', 'i', 'my', 'me', 'he', 'she', 'his', 'her',
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'if', 'then',
  'so', 'not', 'no', 'yes', 'ok', 'okay', 'just', 'very', 'really',
  'also', 'already', 'still', 'even', 'only', 'here', 'there', 'now',
  'then', 'too', 'up', 'out', 'about', 'like', 'use', 'get', 'got',
  'make', 'made', 'take', 'put', 'come', 'go', 'see', 'know', 'think',
  'true', 'false', 'none', 'null', 'new', 'old', 'all', 'any', 'some',
  'return', 'print', 'def', 'class', 'import', 'from',
  // Prose/common
  'step', 'usage', 'run', 'check', 'find', 'add', 'set', 'list',
  'path', 'file', 'type', 'name', 'note', 'example', 'option', 'result',
  'error', 'warning', 'info', 'next', 'last', 'first', 'second',
  'mode', 'test', 'stop', 'start', 'data', 'item', 'key', 'value',
  'world', 'well', 'want', 'human', 'people', 'thing', 'time', 'day',
  'life', 'place', 'way', 'part', 'kind', 'point', 'idea', 'fact',
  'question', 'answer', 'reason', 'number', 'version', 'system',
  'hey', 'hi', 'hello', 'thanks', 'thank', 'right', 'ok',
  // UI/action
  'click', 'press', 'tap', 'drag', 'drop', 'open', 'close', 'save',
  'load', 'launch', 'install', 'search', 'find', 'show', 'hide',
  // Abstract
  'memory', 'language', 'model', 'network', 'training', 'learning',
  'agent', 'tool', 'ethics', 'future', 'science', 'technology',
  'society', 'culture', 'history', 'intelligence',
]);

// ── Helper ──

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ══════════════════════════════════════════════════════════════════
// EntityRegistry
// ══════════════════════════════════════════════════════════════════

export interface EntityRegistryData {
  version: number;
  mode: 'work' | 'personal' | 'combo';
  people: Record<string, PersonInfo>;
  projects: string[];
  ambiguousFlags: string[];
}

export class EntityRegistry {
  private data: EntityRegistryData;

  constructor(data?: Partial<EntityRegistryData>) {
    this.data = {
      version: 1,
      mode: 'personal',
      people: {},
      projects: [],
      ambiguousFlags: [],
      ...data,
    };
  }

  // ── Properties ──

  get mode(): string { return this.data.mode; }
  get people(): Record<string, PersonInfo> { return { ...this.data.people }; }
  get projects(): string[] { return [...this.data.projects]; }

  // ── Registration ──

  /**
   * Seed the registry from onboarding data.
   */
  seed(
    mode: 'work' | 'personal' | 'combo',
    people: Array<{ name: string; relationship?: string; context?: string }>,
    projects: string[],
    aliases?: Record<string, string>,
  ): void {
    this.data.mode = mode;
    this.data.projects = [...new Set([...this.data.projects, ...projects])];

    const aliasMap = aliases ?? {};
    const reverseAliases: Record<string, string> = {};
    for (const [k, v] of Object.entries(aliasMap)) {
      reverseAliases[v] = k;
    }

    for (const entry of people) {
      const name = entry.name.trim();
      if (!name) continue;

      this.data.people[name] = {
        source: 'onboarding',
        contexts: [entry.context ?? 'personal'],
        aliases: reverseAliases[name] ? [reverseAliases[name]] : [],
        relationship: entry.relationship ?? '',
        confidence: 1.0,
      };

      // Register aliases
      if (reverseAliases[name]) {
        const alias = reverseAliases[name];
        this.data.people[alias] = {
          source: 'onboarding',
          contexts: [entry.context ?? 'personal'],
          aliases: [name],
          relationship: entry.relationship ?? '',
          confidence: 1.0,
          canonical: name,
        };
      }
    }

    // Flag ambiguous names
    const ambiguous: string[] = [];
    for (const name of Object.keys(this.data.people)) {
      if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
        ambiguous.push(name.toLowerCase());
      }
    }
    this.data.ambiguousFlags = [...new Set([...this.data.ambiguousFlags, ...ambiguous])];
  }

  /**
   * Register or update a person.
   */
  register(name: string, info: PersonInfo): void {
    this.data.people[name] = info;

    if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
      if (!this.data.ambiguousFlags.includes(name.toLowerCase())) {
        this.data.ambiguousFlags.push(name.toLowerCase());
      }
    }
  }

  // ── Lookup ──

  /**
   * Look up a word. Returns entity classification.
   */
  lookup(word: string, context: string = ''): LookupResult {
    const wordLower = word.toLowerCase();

    // 1. Exact match in people registry
    for (const [canonical, info] of Object.entries(this.data.people)) {
      if (wordLower === canonical.toLowerCase() ||
        info.aliases.some(a => wordLower === a.toLowerCase())) {
        // Check disambiguation if ambiguous
        if (this.data.ambiguousFlags.includes(wordLower) && context) {
          const resolved = this.disambiguate(word, context, info);
          if (resolved) return resolved;
        }
        return {
          type: 'person',
          confidence: info.confidence,
          source: info.source,
          name: canonical,
          context: info.contexts,
          needsDisambiguation: false,
        };
      }
    }

    // 2. Project match
    for (const proj of this.data.projects) {
      if (wordLower === proj.toLowerCase()) {
        return {
          type: 'project',
          confidence: 1.0,
          source: 'onboarding',
          name: proj,
          needsDisambiguation: false,
        };
      }
    }

    return {
      type: 'unknown',
      confidence: 0.0,
      source: 'none',
      name: word,
      needsDisambiguation: false,
    };
  }

  /**
   * Disambiguate ambiguous words using context.
   */
  private disambiguate(word: string, context: string, personInfo: PersonInfo): LookupResult | null {
    const wordLower = word.toLowerCase();
    const ctxLower = context.toLowerCase();

    let personScore = 0;
    for (const pat of PERSON_CONTEXT_PATTERNS) {
      if (pat(wordLower).test(ctxLower)) personScore++;
    }

    let conceptScore = 0;
    for (const pat of CONCEPT_CONTEXT_PATTERNS) {
      if (pat(wordLower).test(ctxLower)) conceptScore++;
    }

    if (personScore > conceptScore) {
      return {
        type: 'person',
        confidence: Math.min(0.95, 0.7 + personScore * 0.1),
        source: personInfo.source,
        name: word,
        context: personInfo.contexts,
        needsDisambiguation: false,
        disambiguatedBy: 'context_patterns',
      };
    }
    if (conceptScore > personScore) {
      return {
        type: 'concept',
        confidence: Math.min(0.9, 0.7 + conceptScore * 0.1),
        source: 'context_disambiguated',
        name: word,
        needsDisambiguation: false,
        disambiguatedBy: 'context_patterns',
      };
    }

    return null; // Truly ambiguous
  }

  // ── Query ──

  /**
   * Extract known person names from a query string.
   */
  extractPeopleFromQuery(query: string): string[] {
    const found: string[] = [];

    for (const [canonical, info] of Object.entries(this.data.people)) {
      const namesToCheck = [canonical, ...info.aliases];
      for (const name of namesToCheck) {
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
        if (re.test(query)) {
          if (this.data.ambiguousFlags.includes(name.toLowerCase())) {
            const result = this.disambiguate(name, query, info);
            if (result && result.type === 'person' && !found.includes(canonical)) {
              found.push(canonical);
            }
          } else {
            if (!found.includes(canonical)) found.push(canonical);
          }
        }
      }
    }

    return found;
  }

  // ── Learn from text ──

  /**
   * Scan text for new entity candidates based on frequency + signals.
   * Returns newly discovered candidates.
   */
  learnFromText(text: string, minConfidence: number = 0.75): EntityCandidate[] {
    const candidates = extractCandidates(text);
    const lines = text.split('\n');
    const newCandidates: EntityCandidate[] = [];

    for (const [name, frequency] of Object.entries(candidates)) {
      if (this.data.people[name] || this.data.projects.includes(name)) continue;

      const signals = scoreEntity(name, text, lines);
      const entity = classifyEntity(name, frequency, signals);

      if (entity.type === 'person' && entity.confidence >= minConfidence) {
        this.data.people[name] = {
          source: 'learned',
          contexts: [this.data.mode !== 'combo' ? this.data.mode : 'personal'],
          aliases: [],
          relationship: '',
          confidence: entity.confidence,
          seenCount: frequency,
        };

        if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
          if (!this.data.ambiguousFlags.includes(name.toLowerCase())) {
            this.data.ambiguousFlags.push(name.toLowerCase());
          }
        }

        newCandidates.push(entity);
      }
    }

    return newCandidates;
  }

  // ── Summary ──

  summary(): string {
    const peopleKeys = Object.keys(this.data.people);
    return [
      `Mode: ${this.data.mode}`,
      `People: ${peopleKeys.length} (${peopleKeys.slice(0, 8).join(', ')}${peopleKeys.length > 8 ? '...' : ''})`,
      `Projects: ${this.data.projects.join(', ') || '(none)'}`,
      `Ambiguous flags: ${this.data.ambiguousFlags.join(', ') || '(none)'}`,
    ].join('\n');
  }
}

// ══════════════════════════════════════════════════════════════════
// Detection functions (from entity_detector.py)
// ══════════════════════════════════════════════════════════════════

/**
 * Extract all capitalized proper noun candidates from text.
 * Returns {name: frequency} for names appearing 3+ times.
 */
export function extractCandidates(text: string): Record<string, number> {
  // Single capitalized words
  const raw = text.match(/\b([A-Z][a-z]{1,19})\b/g) ?? [];
  const counts: Record<string, number> = {};

  for (const word of raw) {
    if (!STOPWORDS.has(word.toLowerCase()) && word.length > 1) {
      counts[word] = (counts[word] ?? 0) + 1;
    }
  }

  // Multi-word proper nouns (e.g. "Memory Palace")
  const multi = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  for (const phrase of multi) {
    const words = phrase.split(' ');
    if (!words.some(w => STOPWORDS.has(w.toLowerCase()))) {
      counts[phrase] = (counts[phrase] ?? 0) + 1;
    }
  }

  // Filter: must appear at least 3 times
  return Object.fromEntries(
    Object.entries(counts).filter(([, count]) => count >= 3),
  );
}

/**
 * Score entity signals for a candidate name.
 */
export function scoreEntity(name: string, text: string, lines: string[]): EntitySignals {
  const nameLower = name.toLowerCase();
  const textLower = text.toLowerCase();

  // Person verb patterns
  let personVerbScore = 0;
  for (const pat of PERSON_VERB_PATTERNS) {
    if (pat(nameLower).test(textLower)) personVerbScore += 2;
  }

  // Pronoun proximity — check if pronouns appear within 100 chars of name
  const nameIndex = textLower.indexOf(nameLower);
  const pronounRe = /\b(?:she|her|he|him|his|they|them|their)\b/gi;
  let pronounProximity = 0;
  let match: RegExpExecArray | null;
  while ((match = pronounRe.exec(text)) !== null) {
    const dist = Math.abs(match.index - Math.max(0, nameIndex));
    if (dist < 100) pronounProximity += 1;
  }

  // Dialogue patterns
  let dialogueScore = 0;
  for (const pat of DIALOGUE_PATTERNS) {
    if (pat(name).test(text)) dialogueScore += 2;
  }

  // Project verb patterns
  let projectVerbScore = 0;
  for (const pat of PROJECT_VERB_PATTERNS) {
    if (pat(nameLower).test(textLower)) projectVerbScore += 2;
  }

  // Capitalization ratio — how often is this word capitalized
  const wordRe = new RegExp(`\\b${escapeRegex(name)}\\b`, 'g');
  const allOccurrences = text.match(wordRe) ?? [];
  const capitalizedOccurrences = text.match(new RegExp(`\\b${escapeRegex(name)}\\b`, 'g')) ?? [];
  const capitalRatio = allOccurrences.length > 0
    ? capitalizedOccurrences.length / allOccurrences.length
    : 0;

  // Word count
  const wordCount = name.split(/\s+/).length;

  return {
    personVerbScore,
    pronounProximity,
    dialogueScore,
    projectVerbScore,
    capitalRatio,
    wordCount,
  };
}

/**
 * Classify an entity candidate as person, project, or uncertain.
 */
export function classifyEntity(
  name: string,
  frequency: number,
  signals: EntitySignals,
  singleWordThreshold: number = 3,
): EntityCandidate {
  const totalPersonSignals =
    signals.personVerbScore + signals.pronounProximity + signals.dialogueScore;
  const totalProjectSignals = signals.projectVerbScore;
  const isMultiWord = signals.wordCount > 1;

  // Multi-word capitalized phrases are almost always entities (projects/people)
  if (isMultiWord && totalPersonSignals + totalProjectSignals >= 1) {
    const isPerson = totalPersonSignals > totalProjectSignals;
    return {
      name,
      type: isPerson ? 'person' : 'project',
      confidence: Math.min(0.95, 0.7 + (isPerson ? totalPersonSignals : totalProjectSignals) * 0.1),
      frequency,
      signals,
    };
  }

  // Strong person signals
  if (totalPersonSignals >= singleWordThreshold) {
    const confidence = Math.min(0.95, 0.5 + totalPersonSignals * 0.12 + frequency * 0.02);
    return { name, type: 'person', confidence, frequency, signals };
  }

  // Strong project signals
  if (totalProjectSignals >= singleWordThreshold) {
    const confidence = Math.min(0.9, 0.5 + totalProjectSignals * 0.1 + frequency * 0.02);
    return { name, type: 'project', confidence, frequency, signals };
  }

  // Weak signals — uncertain
  const confidence = Math.min(0.6, 0.3 + frequency * 0.05);
  return {
    name,
    type: 'uncertain',
    confidence,
    frequency,
    signals,
  };
}
