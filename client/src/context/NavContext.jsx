"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../api";
import { useAuth } from "./AuthContext";
import { useRealtime } from "./RealtimeContext";

const NavContext = createContext(null);
const LAST_KEY = "cb_last_workspace";

function readLast() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps the sidebar data (workspaces, projects, channels) alive across pages so the
 * navigation never blanks out while a page loads, and remembers the last workspace
 * so account/home pages still show it.
 */
export function NavProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useRealtime();
  const pathname = usePathname() || "";
  const routeId = pathname.match(/^\/app\/w\/([^/]+)/)?.[1] || null;

  const [lastId, setLastId] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);

  useEffect(() => {
    setLastId(readLast());
  }, []);

  useEffect(() => {
    if (!routeId) return;
    setLastId(routeId);
    try {
      localStorage.setItem(LAST_KEY, routeId);
    } catch {
      /* storage unavailable */
    }
  }, [routeId]);

  const loadWorkspaces = useCallback(() => {
    if (!user) return Promise.resolve();
    return api("/api/workspaces")
      .then((d) => setWorkspaces(d.workspaces))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setProjects([]);
      setChannels([]);
      setLoadedFor(null);
      return;
    }
    loadWorkspaces();
  }, [user, loadWorkspaces]);

  // Only fall back to lastId if it actually belongs to the user's workspaces
  const validLastId = workspaces.some((w) => w._id === lastId) ? lastId : null;
  const workspaceId = routeId || validLastId || workspaces[0]?._id || null;

  const loadSide = useCallback(
    (id) => {
      if (!id || !user) return Promise.resolve();
      return Promise.all([api(`/api/workspaces/${id}/projects`), api(`/api/workspaces/${id}/channels`)])
        .then(([p, c]) => {
          setProjects(p.projects);
          setChannels(c.channels);
          setLoadedFor(id);
        })
        .catch(() => {
          // Workspace was deleted or access was removed: forget it.
          setProjects([]);
          setChannels([]);
          setLoadedFor(null);
          try {
            if (readLast() === id) localStorage.removeItem(LAST_KEY);
          } catch {
            /* ignore */
          }
          setLastId((cur) => (cur === id ? null : cur));
        });
    },
    [user]
  );

  useEffect(() => {
    if (workspaceId && workspaceId !== loadedFor) loadSide(workspaceId);
  }, [workspaceId, loadedFor, loadSide]);

  // Live updates so the sidebar matches what teammates do.
  useEffect(() => {
    if (!socket || !workspaceId) return undefined;
    const myId = user?._id || user?.id;
    const onCreated = ({ project }) => {
      if (project.workspace === workspaceId) setProjects((l) => (l.some((p) => p._id === project._id) ? l : [project, ...l]));
    };
    const onUpdated = ({ project }) => setProjects((l) => l.map((p) => (p._id === project._id ? { ...p, ...project } : p)));
    const onDeleted = ({ projectId }) => setProjects((l) => l.filter((p) => p._id !== projectId));
    const onChannel = ({ channel }) => {
      if (channel.workspace !== workspaceId) return;
      const mine = (channel.members || []).some((m) => (m._id || m) === myId);
      if (mine) setChannels((l) => (l.some((c) => c._id === channel._id) ? l : [...l, channel]));
    };
    const onTask = () => {
      // Progress numbers shown in the sidebar come from the project stats; refresh lazily.
      clearTimeout(onTask.t);
      onTask.t = setTimeout(() => {
        api(`/api/workspaces/${workspaceId}/projects`).then((p) => setProjects(p.projects)).catch(() => {});
      }, 600);
    };
    socket.on("project:created", onCreated);
    socket.on("project:updated", onUpdated);
    socket.on("project:deleted", onDeleted);
    socket.on("channel:created", onChannel);
    socket.on("task:updated", onTask);
    return () => {
      clearTimeout(onTask.t);
      socket.off("project:created", onCreated);
      socket.off("project:updated", onUpdated);
      socket.off("project:deleted", onDeleted);
      socket.off("channel:created", onChannel);
      socket.off("task:updated", onTask);
    };
  }, [socket, workspaceId, user]);

  const value = useMemo(
    () => ({
      workspaceId,
      workspace: workspaces.find((w) => w._id === workspaceId) || null,
      workspaces,
      projects: loadedFor === workspaceId ? projects : [],
      channels: loadedFor === workspaceId ? channels : [],
      setChannels,
      reloadWorkspaces: loadWorkspaces,
      reloadSide: () => loadSide(workspaceId),
    }),
    [workspaceId, workspaces, projects, channels, loadedFor, loadWorkspaces, loadSide]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav() {
  return useContext(NavContext);
}
