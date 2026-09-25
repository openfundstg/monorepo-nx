/** What the demo does with one request. */
export enum DemoAnswerKind {
  /** Let it go to the server. */
  NETWORK = 'NETWORK',
  /** Answer it here, with a body. */
  RESPOND = 'RESPOND',
  /** Answer it here, with an error. */
  REFUSE = 'REFUSE'
}
