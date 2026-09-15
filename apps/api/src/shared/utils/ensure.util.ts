export function ensure<T>(value: T | null | undefined, err?: Error): T {
  if (!value && err) throw err
  return value!
}
