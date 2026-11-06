// Room ids become Firebase RTDB path segments, so reject anything that would
// change the path or is invalid as an RTDB key. Case is preserved.
const INVALID_ROOM_ID_CHARS = /[/.#$[\]]/;

export function isValidRoomId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !INVALID_ROOM_ID_CHARS.test(trimmed);
}
