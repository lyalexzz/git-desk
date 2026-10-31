import { StringDecoder } from 'node:string_decoder'

/** 增量解析 text/event-stream，返回每个事件的 data 内容；多行 data 按 SSE 规范用换行拼接 */
export class SseParser {
  private decoder = new StringDecoder('utf8')
  private buffer = ''
  private data: string[] = []

  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    const events: string[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      this.line(line, events)
    }
    return events
  }

  end(): string[] {
    const events: string[] = []
    const rest = (this.buffer + this.decoder.end()).replace(/\r$/, '')
    this.buffer = ''
    if (rest) this.line(rest, events)
    this.dispatch(events)
    return events
  }

  private line(line: string, events: string[]): void {
    if (line === '') return this.dispatch(events)
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    if (field !== 'data') return
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    this.data.push(value)
  }

  private dispatch(events: string[]): void {
    if (this.data.length) events.push(this.data.join('\n'))
    this.data = []
  }
}
