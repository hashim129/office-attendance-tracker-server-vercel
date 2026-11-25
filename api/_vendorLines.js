/** A legacy invoice has no line IDs. Resolve its current index until the first edit/post assigns a stable ID. */
export const vendorLineId = (line, index) => line.id || `legacy-${index}`;

export function updateVendorPosting(lines, lineId, posted, actorId, at, makeId) {
  const index = lines.findIndex((line, i) => vendorLineId(line, i) === lineId);
  if (index < 0) return null;
  return lines.map((line, i) => i === index ? { ...line, id: line.id || makeId(), posted, postedAt: posted ? at : null, postedBy: posted ? actorId : null } : line);
}
