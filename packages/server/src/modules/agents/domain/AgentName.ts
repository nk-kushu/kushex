/** Largest agent source accepted for saving or reading. */
export const MAX_AGENT_SOURCE_BYTES = 512 * 1024;

/**
 * An agent's name, which is also its folder name, so it never contains separators
 * or dots: lowercase letters, digits and dashes, starting with a letter.
 */
export class AgentName {
  static readonly pattern = /^[a-z][a-z0-9-]{0,62}$/;

  constructor(readonly value: string) {
    if (!AgentName.pattern.test(value)) throw new Error(`Invalid agent name: ${value}`);
  }

  static isValid(value: string): boolean {
    return AgentName.pattern.test(value);
  }

  toString(): string {
    return this.value;
  }
}
