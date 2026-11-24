export type OrganizationAccess = {
  id?: string;
  users?: Array<{ role?: string }>;
};

export const readOrganizationAccess = (context?: {
  requestContext?: { get?: (key: string) => unknown };
}): OrganizationAccess | undefined => {
  const raw = context?.requestContext?.get?.('organization');

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as OrganizationAccess;
    } catch {
      return undefined;
    }
  }

  return raw as OrganizationAccess | undefined;
};

export const canManageSkills = (
  organization?: OrganizationAccess
): boolean => {
  if (!organization) {
    return false;
  }

  if (!organization.users || organization.users.length === 0) {
    return true;
  }

  return organization.users.some(
    (member) => member.role === 'ADMIN' || member.role === 'SUPERADMIN'
  );
};
