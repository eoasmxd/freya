import type { FreyaContext } from './context.js';

export interface FreyaSubcommand {
  name: string;
  description: string;
  usage?: string;
}

export interface FreyaCommand {
  name: string;
  description: string;
  alias?: string[];
  subcommands?: FreyaSubcommand[];
  execute(
    args: string[],
    sessionId: string,
    ctx: FreyaContext,
    connectionId?: string
  ): Promise<string | void>;
}
