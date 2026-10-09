import { createBrowserRouter } from "react-router";
import { AuthGate } from "./auth/AuthGate.js";
import { AppShell } from "./components/AppShell.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { CallbackPage } from "./pages/CallbackPage.js";
import { ConceptPage } from "./pages/ConceptPage.js";
import { FilePage } from "./pages/FilePage.js";
import { HealthPage } from "./pages/HealthPage.js";
import { MetricsPage } from "./pages/MetricsPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { ProjectPage } from "./pages/ProjectPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { SearchPage } from "./pages/SearchPage.js";

export const router = createBrowserRouter(
  [
    {
      path: "/callback",
      element: <CallbackPage />,
    },
    {
      element: <AuthGate />,
      children: [
        {
          element: <AppShell />,
          children: [
            {
              index: true,
              element: <ProjectsPage />,
            },
            {
              path: "search",
              element: <SearchPage />,
            },
            {
              path: "metrics",
              element: <MetricsPage />,
            },
            {
              path: "p/:project",
              element: <ProjectPage />,
            },
            {
              path: "p/:project/activity",
              element: <ActivityPage />,
            },
            {
              path: "p/:project/health",
              element: <HealthPage />,
            },
            {
              path: "p/:project/c/*",
              element: <ConceptPage />,
            },
            {
              path: "p/:project/f/*",
              element: <FilePage />,
            },
            {
              path: "*",
              element: <NotFoundPage />,
            },
          ],
        },
      ],
    },
  ],
  {
    basename: "/ui",
  },
);
