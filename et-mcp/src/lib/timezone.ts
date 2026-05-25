/** Returns YYYY-MM-DD for "today" in the given IANA timezone. */
export function todayInTz(timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    return fmt.format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}
