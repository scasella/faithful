/**
 * Incremental parser for a text/event-stream body (WHATWG "server-sent events" framing). Used by the LiveAdapter,
 * which reads the stream with fetch() because EventSource cannot send the x-faithful-token header.
 */
export interface SseMessage {
  event: string;
  data: string;
  id: string | null;
}

export class SseParser {
  private buf = '';
  private data: string[] = [];
  private event = '';
  private id: string | null = null;

  /** Feed a chunk; returns the messages completed by it. */
  push(chunk: string): SseMessage[] {
    this.buf += chunk;
    const out: SseMessage[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buf);
      if (!m) break;
      // A lone trailing \r may be the first half of \r\n: wait for more input.
      if (m[0] === '\r' && m.index === this.buf.length - 1) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      if (line === '') {
        if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n'), id: this.id });
        this.data = [];
        this.event = '';
        continue;
      }
      if (line.startsWith(':')) continue;
      const c = line.indexOf(':');
      const field = c === -1 ? line : line.slice(0, c);
      let value = c === -1 ? '' : line.slice(c + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') this.data.push(value);
      else if (field === 'event') this.event = value;
      else if (field === 'id') this.id = value;
    }
    return out;
  }
}
