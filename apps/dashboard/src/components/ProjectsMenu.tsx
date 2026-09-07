import Link from "next/link";

import { getPersistence } from "../lib/persistence.js";
import { selectRecentProjects, type ProjectNavigationItem } from "../lib/projectNavigation.js";

export async function ProjectsMenu() {
  let projects: readonly ProjectNavigationItem[] = [];
  let unavailable = false;

  try {
    const persistence = await getPersistence();
    projects = selectRecentProjects(await persistence.projects.list());
  } catch {
    unavailable = true;
    console.error("Header project shortcuts unavailable");
  }

  return (
    <details className="projects-menu">
      <summary>Projects</summary>
      <div className="projects-menu-panel">
        {unavailable ? (
          <span className="projects-menu-state">Projects unavailable</span>
        ) : projects.length === 0 ? (
          <span className="projects-menu-state">No projects</span>
        ) : (
          <ul aria-label="Recent projects">
            {projects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
