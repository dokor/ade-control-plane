export type ProjectNavigationItem = {
  id: string;
  name: string;
  createdAt: string;
};

const RECENT_PROJECT_LIMIT = 5;

export function selectRecentProjects<T extends ProjectNavigationItem>(
  projects: readonly T[],
  limit = RECENT_PROJECT_LIMIT,
): readonly T[] {
  const boundedLimit = Math.max(0, Math.trunc(limit));
  return [...projects]
    .sort((left, right) => {
      const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
      return byCreatedAt !== 0 ? byCreatedAt : right.id.localeCompare(left.id);
    })
    .slice(0, boundedLimit);
}
