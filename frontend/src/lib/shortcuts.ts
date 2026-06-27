export function isConnectShortcut(
  event: Pick<KeyboardEvent, "code" | "key">,
): boolean {
  return event.code === "KeyE" || event.key.toLowerCase() === "e";
}
