"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../api";
import AppShell from "../components/AppShell";
import { Avatar } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useNav } from "../context/NavContext";
import { useRealtime } from "../context/RealtimeContext";
import { roleLabel } from "../lib/format";

const ORGANIZATION_ROLES = [
  ["organization_admin", "CEO / Company Owner"],
  ["business_management", "Business Management"],
  ["project_manager", "Project Manager"],
  ["team_lead", "Team Lead"],
  ["developer", "Developer"],
  ["qa_tester", "QA Tester"],
  ["viewer", "Viewer"],
];

const PERMISSION_SUMMARY = [
  ["Super Admin", "Platform-wide organization management and recovery."],
  ["CEO / Company Owner", "Company-wide visibility, organization settings, project proposal decisions, and location assignment."],
  ["Business Management", "Work across company locations to prepare client proposals for CEO approval."],
  ["Project Manager", "Create and manage assigned projects, plans, and team workload reports."],
  ["Team Lead", "Access assigned department projects and team workload reports."],
  ["Developer", "Work on assigned development team projects."],
  ["QA Tester", "Work on assigned QA projects."],
  ["Viewer", "Read organization and workload reports without changing data."],
];

function isAdmin(role, user) {
  return role === "organization_admin" || user?.platformRole === "super_admin";
}

export default function Organizations() {
  const { user } = useAuth();
  const { workspaces, reloadWorkspaces } = useNav();
  const { onlineUserIds } = useRealtime();
  const [organizations, setOrganizations] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [organization, setOrganization] = useState(null);
  const [myRole, setMyRole] = useState("");
  const [workload, setWorkload] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createForm, setCreateForm] = useState({ name: "", description: "", website: "" });
  const [profile, setProfile] = useState({ name: "", description: "", website: "", defaultTaskCapacity: 10 });
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });
  const [departmentForm, setDepartmentForm] = useState({ name: "", description: "", positions: "" });
  const [locationForm, setLocationForm] = useState({ name: "", address: "", contactName: "", contactEmail: "", contactPhone: "", workspaceId: "" });
  const [editingLocationId, setEditingLocationId] = useState("");
  const [proposalForm, setProposalForm] = useState({
    name: "",
    clientName: "",
    description: "",
    quotation: "",
    currency: "INR",
    startDate: "",
    expectedCompletionDate: "",
  });
  const [proposalLocations, setProposalLocations] = useState({});
  const [proposalNotes, setProposalNotes] = useState({});
  const [workspaceToLink, setWorkspaceToLink] = useState("");

  const isSuperAdmin = user?.platformRole === "super_admin";
  const canAdmin = isAdmin(myRole, user);
  const canSubmitProposals = canAdmin || myRole === "business_management";
  const canReport = canAdmin || ["project_manager", "team_lead", "viewer"].includes(myRole);
  const unlinkedWorkspaces = useMemo(
    () => workspaces.filter((workspace) =>
      !workspace.organizationId || String(workspace.organizationId) === String(organizationId)
    ),
    [workspaces, organizationId]
  );
  const selectedWorkspace = unlinkedWorkspaces.find((workspace) => workspace._id === workspaceToLink);

  function flash(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 3000);
  }

  async function loadOrganizations() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/organizations");
      setOrganizations(data.organizations);
      setOrganizationId((current) =>
        data.organizations.some((item) => item._id === current) ? current : data.organizations[0]?._id || ""
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrganization(id = organizationId) {
    if (!id) {
      setOrganization(null);
      setMyRole("");
      setWorkload([]);
      setInvitations([]);
      setProposals([]);
      return;
    }
    setError("");
    try {
      const detail = await api(`/api/organizations/${id}`);
      setOrganization(detail.organization);
      setMyRole(detail.myRole);
      setProfile({
        name: detail.organization.name,
        description: detail.organization.description || "",
        website: detail.organization.website || "",
        defaultTaskCapacity: detail.organization.settings?.defaultTaskCapacity || 10,
      });
      const permittedAdmin = isAdmin(detail.myRole, user);
      const reportPromise = permittedAdmin || ["project_manager", "team_lead", "viewer"].includes(detail.myRole)
        ? api(`/api/organizations/${id}/workload`).then((data) => setWorkload(data.workload))
        : Promise.resolve(setWorkload([]));
      const invitationPromise = permittedAdmin
        ? api(`/api/organizations/${id}/invitations`).then((data) => setInvitations(data.invitations))
        : Promise.resolve(setInvitations([]));
      const proposalPromise = permittedAdmin || detail.myRole === "business_management"
        ? api(`/api/organizations/${id}/proposals`).then((data) => setProposals(data.proposals))
        : Promise.resolve(setProposals([]));
      await Promise.all([reportPromise, invitationPromise, proposalPromise]);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadOrganizations();
    // An invite notification links here with a short-lived, single-use token.
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    api("/api/organizations/invitations/accept", { method: "POST", body: { token } })
      .then(() => {
        window.history.replaceState({}, "", "/app/organizations");
        flash("Organization invitation accepted");
        return loadOrganizations();
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (organizationId) loadOrganization(organizationId);
    else {
      setOrganization(null);
      setMyRole("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function mutate(path, options, success) {
    setError("");
    try {
      await api(path, options);
      await loadOrganization();
      await loadOrganizations();
      reloadWorkspaces();
      flash(success);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function createOrganization(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api("/api/organizations", { method: "POST", body: createForm });
      setOrganizations((items) => [...items, data.organization]);
      setOrganizationId(data.organization._id);
      setCreateForm({ name: "", description: "", website: "" });
      flash("Organization created");
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    await mutate(`/api/organizations/${organizationId}`, {
      method: "PATCH",
      body: { ...profile, defaultTaskCapacity: Number(profile.defaultTaskCapacity) },
    }, "Organization settings saved");
  }

  async function inviteMember(event) {
    event.preventDefault();
    await mutate(`/api/organizations/${organizationId}/invitations`, {
      method: "POST",
      body: inviteForm,
    }, "Invitation sent. The teammate can accept it from their CollabBoard notifications.");
    setInviteForm({ email: "", role: "viewer" });
  }

  async function createDepartment(event) {
    event.preventDefault();
    await mutate(`/api/organizations/${organizationId}/departments`, {
      method: "POST",
      body: {
        name: departmentForm.name,
        description: departmentForm.description,
        positions: departmentForm.positions.split(",").map((position) => position.trim()).filter(Boolean),
      },
    }, "Department created");
    setDepartmentForm({ name: "", description: "", positions: "" });
  }

  async function saveLocation(event) {
    event.preventDefault();
    const editing = Boolean(editingLocationId);
    const saved = await mutate(
      editing
        ? `/api/organizations/${organizationId}/locations/${editingLocationId}`
        : `/api/organizations/${organizationId}/locations`,
        {
          method: editing ? "PATCH" : "POST",
          body: { ...locationForm, workspaceId: locationForm.workspaceId || null },
        },
      editing ? "Location updated" : "Location added"
    );
    if (saved) {
        setLocationForm({ name: "", address: "", contactName: "", contactEmail: "", contactPhone: "", workspaceId: "" });
      setEditingLocationId("");
    }
  }

  function editLocation(location) {
    setLocationForm({
      name: location.name,
      address: location.address,
      contactName: location.contactName || "",
      contactEmail: location.contactEmail || "",
      contactPhone: location.contactPhone || "",
      workspaceId: location.workspace?._id || location.workspace || "",
    });
    setEditingLocationId(location._id);
  }

  async function removeLocation(location) {
    if (!window.confirm(`Remove ${location.name} from this organization?`)) return;
    const removed = await mutate(`/api/organizations/${organizationId}/locations/${location._id}`, {
      method: "DELETE",
    }, "Location removed");
    if (removed && editingLocationId === location._id) {
      setEditingLocationId("");
      setLocationForm({ name: "", address: "", contactName: "", contactEmail: "", contactPhone: "", workspaceId: "" });
    }
  }

  async function submitProposal(event) {
    event.preventDefault();
    const saved = await mutate(`/api/organizations/${organizationId}/proposals`, {
      method: "POST",
      body: {
        ...proposalForm,
        quotation: Number(proposalForm.quotation),
        startDate: new Date(`${proposalForm.startDate}T00:00:00`).toISOString(),
        expectedCompletionDate: new Date(`${proposalForm.expectedCompletionDate}T00:00:00`).toISOString(),
      },
    }, "Project proposal submitted to the CEO");
    if (saved) {
      setProposalForm({
        name: "",
        clientName: "",
        description: "",
        quotation: "",
        currency: "INR",
        startDate: "",
        expectedCompletionDate: "",
      });
    }
  }

  async function decideProposal(proposal, action) {
    const saved = await mutate(`/api/organizations/${organizationId}/proposals/${proposal._id}/decision`, {
      method: "POST",
      body: {
        action,
        locationIds: action === "approve" ? proposalLocations[proposal._id] || [] : [],
        note: proposalNotes[proposal._id] || "",
      },
    }, action === "approve" ? "Project approved and assigned to locations" : "Project proposal rejected");
    if (saved) {
      setProposalLocations((current) => ({ ...current, [proposal._id]: [] }));
      setProposalNotes((current) => ({ ...current, [proposal._id]: "" }));
    }
  }

  async function assignMember(member, changes) {
    await mutate(`/api/organizations/${organizationId}/members/${member.user._id}`, {
      method: "PATCH",
      body: changes,
    }, "Member updated");
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.user.name} from this organization?`)) return;
    await mutate(`/api/organizations/${organizationId}/members/${member.user._id}`, {
      method: "DELETE",
    }, "Member removed");
  }

  async function updateDepartment(department, changes) {
    await mutate(`/api/organizations/${organizationId}/departments/${department._id}`, {
      method: "PATCH",
      body: changes,
    }, "Department updated");
  }

  async function removeDepartment(department) {
    if (!window.confirm(`Remove ${department.name}? Reassign its members and project teams first.`)) return;
    await mutate(`/api/organizations/${organizationId}/departments/${department._id}`, {
      method: "DELETE",
    }, "Department removed");
  }

  async function linkWorkspace(event) {
    event.preventDefault();
    if (!workspaceToLink) return;
    await mutate(`/api/organizations/${organizationId}/workspaces/${workspaceToLink}`, {
      method: "PUT",
    }, `Linked ${selectedWorkspace?.name || "workspace"}`);
    setWorkspaceToLink("");
  }

  async function unlinkWorkspace(workspace) {
    if (!window.confirm(`Unlink ${workspace.name}? Its existing workspace membership and data will remain unchanged.`)) return;
    await mutate(`/api/organizations/${organizationId}/workspaces/${workspace._id}`, {
      method: "DELETE",
    }, "Workspace unlinked");
  }

  async function revokeInvitation(invitation) {
    await mutate(`/api/organizations/${organizationId}/invitations/${invitation.id}`, {
      method: "DELETE",
    }, "Invitation revoked");
  }

  const departments = organization?.departments || [];
  const members = organization?.members || [];
  const locationWorkspaces = organization?.locations || [];
  const availableLocationWorkspaces = workspaces.filter((workspace) =>
    (!workspace.organizationId || String(workspace.organizationId) === String(organizationId)) &&
    !locationWorkspaces.some((location) =>
      String(location._id) !== String(editingLocationId) &&
      String(location.workspace?._id || location.workspace || "") === String(workspace._id)
    )
  );

  return (
    <AppShell>
      <div className="page-head organization-page-head">
        <div className="grow">
          <h1>Organizations</h1>
          <p className="muted">Manage your company, locations, client project proposals, and teams.</p>
        </div>
        {isSuperAdmin && <span className="role-pill owner">Platform Super Admin</span>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {loading && <div className="skeleton" />}

      <div className="organization-layout">
        <aside className="box organization-picker">
          <div className="section-head">
            <h2>Your organizations</h2>
            <span className="count">{organizations.length}</span>
          </div>
          {organizations.map((item) => (
            <button
              type="button"
              key={item._id}
              className={`organization-option ${organizationId === item._id ? "on" : ""}`}
              onClick={() => setOrganizationId(item._id)}
            >
              <span className="organization-mark">{item.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{item.name}</strong><small>{item.members?.length || 0} members · {item.workspaces?.length || 0} workspaces</small></span>
            </button>
          ))}
          {!organizations.length && !loading && (
            <>
              <p className="muted">Create an organization to manage your team.</p>
              <form className="organization-create-form" onSubmit={createOrganization}>
                <h3>Create organization</h3>
                <label className="field">
                  <span>Name</span>
                  <input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} required minLength={2} maxLength={80} />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea rows={2} value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} maxLength={500} />
                </label>
                <button className="btn" disabled={!createForm.name.trim()}>Create organization</button>
              </form>
            </>
          )}
        </aside>

        {organization ? (
          <main className="organization-content">
            <section className="box">
              <div className="organization-title">
                <div>
                  <span className="eyebrow">{roleLabel(myRole)}</span>
                  <h2>{organization.name}</h2>
                  <p className="muted">{organization.description || "Organization profile and team administration."}</p>
                </div>
                <span className="organization-counts">{members.length} members · {organization.workspaces?.length || 0} linked workspaces</span>
              </div>
              {canAdmin ? (
                <form className="organization-profile-form" onSubmit={saveProfile}>
                  <label className="field"><span>Organization name</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required minLength={2} maxLength={80} /></label>
                  <label className="field"><span>Website</span><input type="url" value={profile.website} onChange={(event) => setProfile({ ...profile, website: event.target.value })} maxLength={200} placeholder="https://example.com" /></label>
                  <label className="field"><span>Description</span><textarea rows={2} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} maxLength={500} /></label>
                  <label className="field"><span>Default task capacity per person</span><input type="number" min="1" max="100" value={profile.defaultTaskCapacity} onChange={(event) => setProfile({ ...profile, defaultTaskCapacity: event.target.value })} /></label>
                  <button className="btn">Save organization settings</button>
                </form>
              ) : (
                <div className="organization-readonly"><span>{organization.website || "No website set"}</span><span>Default capacity: {organization.settings?.defaultTaskCapacity || 10} open tasks</span></div>
              )}
            </section>

            <section className="box">
              <div className="section-head">
                <div><h2>Company locations</h2><p className="muted">Keep your branch offices together under {organization.name}.</p></div>
                <span className="count">{organization.locations?.length || 0}</span>
              </div>
              {canAdmin && (
                <form className="organization-location-form" onSubmit={saveLocation}>
                  <label className="field"><span>Location name</span><input value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} required minLength={2} maxLength={80} placeholder="e.g. Bengaluru Office" /></label>
                  <label className="field"><span>Address</span><textarea rows={2} value={locationForm.address} onChange={(event) => setLocationForm({ ...locationForm, address: event.target.value })} required maxLength={500} /></label>
                  <label className="field"><span>Contact name</span><input value={locationForm.contactName} onChange={(event) => setLocationForm({ ...locationForm, contactName: event.target.value })} maxLength={80} /></label>
                  <label className="field"><span>Contact email</span><input type="email" value={locationForm.contactEmail} onChange={(event) => setLocationForm({ ...locationForm, contactEmail: event.target.value })} maxLength={254} /></label>
                  <label className="field"><span>Contact phone</span><input type="tel" value={locationForm.contactPhone} onChange={(event) => setLocationForm({ ...locationForm, contactPhone: event.target.value })} maxLength={40} /></label>
                  <label className="field"><span>Location workspace</span>
                    <select required value={locationForm.workspaceId} onChange={(event) => setLocationForm({ ...locationForm, workspaceId: event.target.value })}>
                      <option value="">Select a workspace</option>
                      {availableLocationWorkspaces.map((workspace) => <option key={workspace._id} value={workspace._id}>{workspace.name}</option>)}
                    </select>
                  </label>
                  <div className="organization-location-actions">
                    <button className="btn" disabled={!locationForm.name.trim() || !locationForm.address.trim() || !locationForm.workspaceId}>{editingLocationId ? "Save location" : "Add location"}</button>
                    {editingLocationId && <button className="btn secondary" type="button" onClick={() => {
                      setEditingLocationId("");
                      setLocationForm({ name: "", address: "", contactName: "", contactEmail: "", contactPhone: "", workspaceId: "" });
                    }}>Cancel</button>}
                  </div>
                </form>
              )}
              <div className="organization-locations">
                {(organization.locations || []).map((location) => (
                  <article className="organization-location" key={location._id}>
                    <div className="organization-location-details">
                      <strong>{location.name}</strong>
                      <span>{location.address}</span>
                      <small>Workspace: {location.workspace?.name || "Not linked"}</small>
                      {(location.contactName || location.contactEmail || location.contactPhone) && (
                        <small>{[location.contactName, location.contactEmail, location.contactPhone].filter(Boolean).join(" · ")}</small>
                      )}
                    </div>
                    {canAdmin && <div className="organization-location-actions">
                      <button className="btn secondary" type="button" onClick={() => editLocation(location)}>Edit</button>
                      <button className="btn secondary" type="button" onClick={() => removeLocation(location)}>Remove</button>
                    </div>}
                  </article>
                ))}
                {!organization.locations?.length && <div className="empty">No company locations have been added yet.</div>}
              </div>
            </section>

            {(canSubmitProposals || canAdmin) && (
              <section className="box">
                <div className="section-head">
                  <div><h2>Client project proposals</h2><p className="muted">Business Management submits client details and a quotation; the CEO approves and assigns each project to locations.</p></div>
                  <span className="count">{proposals.length}</span>
                </div>
                {canSubmitProposals && (
                  <form className="organization-proposal-form" onSubmit={submitProposal}>
                    <label className="field"><span>Project name</span><input required minLength={2} maxLength={80} value={proposalForm.name} onChange={(event) => setProposalForm({ ...proposalForm, name: event.target.value })} /></label>
                    <label className="field"><span>Client name</span><input required minLength={2} maxLength={120} value={proposalForm.clientName} onChange={(event) => setProposalForm({ ...proposalForm, clientName: event.target.value })} /></label>
                    <label className="field"><span>Project description</span><textarea required rows={3} maxLength={400} value={proposalForm.description} onChange={(event) => setProposalForm({ ...proposalForm, description: event.target.value })} /></label>
                    <div className="organization-proposal-quote">
                      <label className="field"><span>Quotation amount</span><input type="number" min="0" step="0.01" required value={proposalForm.quotation} onChange={(event) => setProposalForm({ ...proposalForm, quotation: event.target.value })} placeholder="0.00" /></label>
                      <label className="field"><span>Currency code</span><input required value={proposalForm.currency} onChange={(event) => setProposalForm({ ...proposalForm, currency: event.target.value.toUpperCase() })} maxLength={3} minLength={3} pattern="[A-Za-z]{3}" /></label>
                    </div>
                    <label className="field"><span>Proposed start date</span><input type="date" required value={proposalForm.startDate} onChange={(event) => setProposalForm({ ...proposalForm, startDate: event.target.value })} /></label>
                    <label className="field"><span>Expected completion date</span><input type="date" required min={proposalForm.startDate || undefined} value={proposalForm.expectedCompletionDate} onChange={(event) => setProposalForm({ ...proposalForm, expectedCompletionDate: event.target.value })} /></label>
                    <button className="btn" disabled={!proposalForm.startDate || !proposalForm.expectedCompletionDate}>Submit proposal to CEO</button>
                  </form>
                )}
                <div className="organization-proposals">
                  {proposals.map((proposal) => (
                    <article className="organization-proposal" key={proposal._id}>
                      <div className="organization-proposal-summary">
                        <div>
                          <strong>{proposal.name} · {proposal.clientName}</strong>
                          <span>{proposal.description}</span>
                          <small>Quotation: {proposal.currency} {proposal.quotation} · {new Date(proposal.startDate).toLocaleDateString()}–{new Date(proposal.expectedCompletionDate).toLocaleDateString()}</small>
                          <small>Submitted by {proposal.submittedBy?.name || "Business Management"} · {proposal.status.replace(/_/g, " ")}</small>
                          {proposal.decision?.note && <small>CEO note: {proposal.decision.note}</small>}
                        </div>
                      </div>
                      {canAdmin && proposal.status === "pending_ceo" && (
                        <div className="organization-proposal-decision">
                          <label className="field"><span>Assign to locations</span>
                            <select
                              multiple
                              value={proposalLocations[proposal._id] || []}
                              onChange={(event) => setProposalLocations((current) => ({
                                ...current,
                                [proposal._id]: Array.from(event.target.selectedOptions, (option) => option.value),
                              }))}
                            >
                              {locationWorkspaces.filter((location) => location.workspace).map((location) => (
                                <option key={location._id} value={location._id}>{location.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field"><span>Decision note</span><textarea rows={2} maxLength={1000} value={proposalNotes[proposal._id] || ""} onChange={(event) => setProposalNotes((current) => ({ ...current, [proposal._id]: event.target.value }))} /></label>
                          <div className="organization-location-actions">
                            <button className="btn" type="button" disabled={!proposalLocations[proposal._id]?.length} onClick={() => decideProposal(proposal, "approve")}>Approve and assign</button>
                            <button className="btn secondary" type="button" onClick={() => decideProposal(proposal, "reject")}>Reject</button>
                          </div>
                        </div>
                      )}
                      {proposal.status === "approved" && (
                        <div className="organization-proposal-projects">
                          <strong>Created location projects</strong>
                          {proposal.projects.map((project) => {
                            const workspace = organization.workspaces?.find((item) => String(item._id) === String(project.workspace));
                            return (
                              <Link key={project._id} href={`/app/w/${project.workspace}/projects/${project._id}`}>
                                {workspace?.name || "Location"}: {project.name}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </article>
                  ))}
                  {!proposals.length && <div className="empty">No project proposals yet.</div>}
                </div>
              </section>
            )}

            <section className="box">
              <div className="section-head"><h2>Organization members</h2><span className="muted">Roles are organization-scoped; workspace access remains separate.</span></div>
              <div className="organization-members">
                {members.map((member) => (
                  <article className="organization-member" key={member.user._id}>
                    <div className="organization-person">
                      <Avatar user={member.user} size={38} />
                      <div><strong>{member.user.name}</strong><span>{member.user.email}</span></div>
                    </div>
                    <label className="field"><span>Organization role</span>
                      {canAdmin ? (
                        <select value={member.role} onChange={(event) => assignMember(member, { role: event.target.value })}>
                          {ORGANIZATION_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      ) : <span className="role-pill">{roleLabel(member.role)}</span>}
                    </label>
                    <label className="field"><span>Department</span>
                      {canAdmin ? (
                        <select value={member.department || ""} onChange={(event) => {
                          const department = event.target.value;
                          const positions = departments.find((item) => item.name === department)?.positions || [];
                          assignMember(member, { department, title: positions.includes(member.title) ? member.title : (positions[0] || "") });
                        }}>
                          <option value="">Unassigned</option>
                          {departments.filter((department) => department.active).map((department) => <option key={department._id} value={department.name}>{department.name}</option>)}
                        </select>
                      ) : <span>{member.department || "Unassigned"}</span>}
                    </label>
                    <label className="field"><span>Position</span>
                      {canAdmin ? (
                        <select value={member.title || ""} disabled={!member.department} onChange={(event) => assignMember(member, { title: event.target.value })}>
                          <option value="">Unassigned</option>
                          {(departments.find((item) => item.name === member.department)?.positions || []).map((title) => <option key={title} value={title}>{title}</option>)}
                        </select>
                      ) : <span>{member.title || "Unassigned"}</span>}
                    </label>
                    <div className="organization-member-actions">
                      {member.user.platformRole === "super_admin" && <span className="role-pill owner">Super Admin</span>}
                      {canAdmin && <button className="btn secondary" type="button" onClick={() => removeMember(member)}>Remove</button>}
                    </div>
                  </article>
                ))}
                {!members.length && <div className="empty">No members yet.</div>}
              </div>
            </section>

            {canAdmin && (
              <section className="organization-two-column">
                <div className="box">
                  <h2>Invite a member</h2>
                  <p className="muted">Invitations expire after seven days and can only be accepted by the invited email account.</p>
                  <form className="col-form" onSubmit={inviteMember}>
                    <label className="field"><span>Email</span><input type="email" required value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} /></label>
                    <label className="field"><span>Organization role</span>
                      <select value={inviteForm.role} onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value })}>
                        {ORGANIZATION_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <button className="btn" disabled={!inviteForm.email.trim()}>Send invitation</button>
                  </form>
                  <div className="organization-invitations">
                    <h3>Pending invitations</h3>
                    {invitations.map((invitation) => (
                      <div className="organization-invitation" key={invitation.id}>
                        <div><strong>{invitation.email}</strong><span>{roleLabel(invitation.role)} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div>
                        <button className="link-btn" type="button" onClick={() => revokeInvitation(invitation)}>Revoke</button>
                      </div>
                    ))}
                    {!invitations.length && <p className="muted">No pending invitations.</p>}
                  </div>
                </div>

                <div className="box">
                  <h2>Departments</h2>
                  <form className="col-form" onSubmit={createDepartment}>
                    <label className="field"><span>Department name</span><input value={departmentForm.name} onChange={(event) => setDepartmentForm({ ...departmentForm, name: event.target.value })} required maxLength={60} /></label>
                    <label className="field"><span>Description</span><input value={departmentForm.description} onChange={(event) => setDepartmentForm({ ...departmentForm, description: event.target.value })} maxLength={300} /></label>
                    <label className="field"><span>Positions (comma-separated)</span><input value={departmentForm.positions} onChange={(event) => setDepartmentForm({ ...departmentForm, positions: event.target.value })} placeholder="Team Lead, Developer" /></label>
                    <button className="btn" disabled={!departmentForm.name.trim()}>Add department</button>
                  </form>
                  <div className="organization-departments">
                    {departments.map((department) => (
                      <article className="organization-department" key={department._id}>
                        <div className="organization-department-heading">
                          <div><strong>{department.name}</strong><span>{department.positions.join(" · ") || "No positions"}</span></div>
                          <button className="btn secondary" type="button" onClick={() => removeDepartment(department)}>Remove</button>
                        </div>
                        <label className="field"><span>Department manager</span>
                          <select value={department.manager?._id || ""} onChange={(event) => updateDepartment(department, { managerId: event.target.value || null })}>
                            <option value="">No manager</option>
                            {members.filter((member) => member.role === "team_lead" || member.role === "organization_admin").map((member) =>
                              <option key={member.user._id} value={member.user._id}>{member.user.name}</option>
                            )}
                          </select>
                        </label>
                        <label className="check"><input type="checkbox" checked={department.active} onChange={(event) => updateDepartment(department, { active: event.target.checked })} /> Active for new assignments</label>
                      </article>
                    ))}
                    {!departments.length && <div className="empty">No departments yet.</div>}
                  </div>
                </div>
              </section>
            )}

            {canAdmin && (
              <section className="box">
                <div className="section-head"><div><h2>Linked workspaces</h2><p className="muted">Only a workspace owner/admin can link or unlink it. Existing workspace data and membership stay unchanged.</p></div></div>
                <form className="organization-link-form" onSubmit={linkWorkspace}>
                  <select value={workspaceToLink} onChange={(event) => setWorkspaceToLink(event.target.value)} aria-label="Workspace to link">
                    <option value="">Select a workspace you administer</option>
                    {unlinkedWorkspaces.filter((workspace) => !organization.workspaces?.some((item) => item._id === workspace._id)).map((workspace) =>
                      <option key={workspace._id} value={workspace._id}>{workspace.name}</option>
                    )}
                  </select>
                  <button className="btn" disabled={!workspaceToLink}>Link workspace</button>
                </form>
                <div className="organization-workspaces">
                  {(organization.workspaces || []).map((workspace) => (
                    <div className="organization-workspace" key={workspace._id}>
                      <strong>{workspace.name}</strong><span>{workspace.description || "Workspace"}</span>
                      <button className="btn secondary" type="button" onClick={() => unlinkWorkspace(workspace)}>Unlink</button>
                    </div>
                  ))}
                  {!organization.workspaces?.length && <div className="empty">No workspaces are linked to this organization yet.</div>}
                </div>
              </section>
            )}

            {canReport && (
              <section className="box">
                <div className="section-head"><div><h2>Team workload</h2><p className="muted">Task counts include linked workspaces only. Presence reflects connected sessions when available.</p></div></div>
                {!organization.workspaces?.length && <div className="empty">Link a workspace to see organization-wide workload.</div>}
                <div className="organization-workload">
                  {workload.map((item) => (
                    <article className="organization-workload-card" key={item.user._id}>
                      <div className="organization-person">
                        <span className="avatar-wrap"><Avatar user={item.user} size={36} /><span className={`dot status ${onlineUserIds.includes(String(item.user._id)) ? "on" : ""}`} /></span>
                        <div><strong>{item.user.name}</strong><span>{item.department || roleLabel(item.role)} · {onlineUserIds.includes(String(item.user._id)) ? "Online" : "Offline"}</span></div>
                      </div>
                      <div className="organization-workload-stats">
                        <span><strong>{item.pending}</strong> pending</span>
                        <span><strong>{item.completed}</strong> completed</span>
                        <span className={item.overdue ? "due overdue" : ""}><strong>{item.overdue}</strong> overdue</span>
                      </div>
                      <div className="organization-capacity">
                        <div><span>Capacity</span><strong>{item.pending}/{organization.settings?.defaultTaskCapacity || 10} open tasks</strong></div>
                        <div className="progress"><div className="progress-fill" style={{ width: `${Math.min(100, item.capacityPercent)}%` }} /></div>
                        <small>{item.workloadShare}% of organization pending work{item.capacityPercent > 100 ? " · over capacity" : ""}</small>
                      </div>
                    </article>
                  ))}
                </div>
                {canAdmin && <p className="muted organization-reports-note">Role capabilities are enforced by the API.</p>}
              </section>
            )}

            <section className="box">
              <h2>Permission overview</h2>
              <p className="muted">Organization roles do not replace workspace membership or project workflow permissions.</p>
              <div className="organization-permissions">
                {PERMISSION_SUMMARY.map(([role, description]) => <div key={role}><strong>{role}</strong><span>{description}</span></div>)}
              </div>
            </section>
          </main>
        ) : !loading && (
          <main className="organization-content">
            <section className="box organization-empty-state">
              <h2>Organization management</h2>
              <p className="muted">Create an organization or accept an invitation to get started. Existing workspaces are not changed unless an authorized workspace admin links them.</p>
              {error && <p className="muted">If you expected to see an organization, check that you have been invited using this account.</p>}
            </section>
          </main>
        )}
      </div>
    </AppShell>
  );
}
