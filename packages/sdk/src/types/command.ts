import type { FreyaContext } from './context.js';
import type { LocalizedText } from './common.js';

export interface FreyaSubcommand {
  name: string;
  description: LocalizedText;
  usage?: string;
}

export interface FreyaCommand {
  name: string;
  description: LocalizedText;
  alias?: string[];
  subcommands?: FreyaSubcommand[];
  execute(
    args: string[],
    sessionId: string,
    ctx: FreyaContext,
    connectionId?: string
  ): Promise<string | void>;
}
