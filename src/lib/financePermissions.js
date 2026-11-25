// Editing is distinct from deletion, settlement and unrelated admin privileges.
export function canEditFinancialRecord(role, actorId, ownerId, kind, status) {
  return ['admin','ceo','accounts'].includes(role) || (actorId === ownerId && (kind !== 'invoice' || status === 'unpaid'));
}
