import { parentPort, workerData } from 'node:worker_threads';

/**
 * 正则匹配工作线程初始化参数
 * Initialization payload for the regex matching worker thread
 */
export interface RegexWorkerInitData {
  pattern: string;
  caseSensitive: boolean;
}

/**
 * 主线程发送给工作线程的单个文件匹配请求
 * Single-file matching request sent from main thread to worker
 */
export interface RegexWorkerRequest {
  id: number;
  content: string;
  maxMatches: number;
}

/**
 * 工作线程返回的单个文件匹配索引结果
 * Single-file match index result returned from worker
 */
export interface RegexWorkerResponse {
  id: number;
  matchedIndices: number[];
  truncated: boolean;
}

if (parentPort && workerData) {
  const port = parentPort;
  const { pattern, caseSensitive } = workerData as RegexWorkerInitData;
  const baseFlags = caseSensitive ? '' : 'i';
  const lineRegex = new RegExp(pattern, baseFlags);
  const hasNegativeLookaround = pattern.includes('(?!') || pattern.includes('(?<!');
  const hasEndAnchor = pattern.includes('$');
  const contentRegex = hasNegativeLookaround ? null : new RegExp(pattern, `${baseFlags}m`);

  port.on('message', (req: RegexWorkerRequest) => {
    if (contentRegex && !(hasEndAnchor && req.content.includes('\r')) && !contentRegex.test(req.content)) {
      const emptyResponse: RegexWorkerResponse = {
        id: req.id,
        matchedIndices: [],
        truncated: false
      };
      port.postMessage(emptyResponse);
      return;
    }

    const lines = req.content.split(/\r?\n/);
    const matchedIndices: number[] = [];
    let truncated = false;

    for (let i = 0; i < lines.length; i++) {
      if (lineRegex.test(lines[i])) {
        if (matchedIndices.length >= req.maxMatches) {
          truncated = true;
          break;
        }
        matchedIndices.push(i);
      }
    }

    const response: RegexWorkerResponse = {
      id: req.id,
      matchedIndices,
      truncated
    };
    port.postMessage(response);
  });
}

