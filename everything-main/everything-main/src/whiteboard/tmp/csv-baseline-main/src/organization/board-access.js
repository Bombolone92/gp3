import { escape } from "../model.js";
import { busy } from "../accessibility/busy.js";
import { addTranslations, labelled, t } from "../i18n.js";
import { canManage } from "../collaboration/protocol.js";
import { orderedFrames } from "../scene.js";

export const ROLE_LABELS = {
  owner: "Owner",
  facilitator: "Facilitator",
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
  removed: "Removed",
};
// Roles someone may hand out: facilitators manage participants, but only the
// owner (or an administrator) appoints facilitators.
export function assignableRoles(role) {
  return role === "owner"
    ? ["facilitator", "editor", "commenter", "viewer"]
    : canManage(role)
      ? ["editor", "commenter", "viewer"]
      : [];
}
// A link to a section of a board opens the board focused on that frame.
export function sectionLink(link, frameId) {
  if (!frameId) return link;
  const url = new URL(link);
  const params = new URLSearchParams(url.hash.slice(1));
  params.set("object", frameId);
  url.hash = params.toString();
  return url.href;
}

export function createBoardAccess({
  org,
  session,
  board,
  modal,
  toast,
  icon,
  refresh = () => {},
  home = () => {},
}) {
  const api = {
    roleOptions(role, selected = "editor") {
      return assignableRoles(role)
        .map(
          (r) =>
            `<option value="${r}" ${r === selected ? "selected" : ""}>${t(ROLE_LABELS[r])}</option>`,
        )
        .join("");
    },
    // Extra share controls: guest invitations and whole-board or section links.
    shareControls() {
      const b = board();
      const frames = b ? orderedFrames(b.items) : [];
      // Only a board on the organization's own server follows its policy;
      // one on another server is shared under that server's rules.
      const external = org.info?.configured && org.server === session()?.server;
      const policy = org.policy();
      // Guests can be invited only where the organization admits them.
      const guests =
        external &&
        policy?.guestAccess !== false &&
        policy?.externalSharing !== "none" &&
        !policy?.restrictToOrganization;
      return `${guests ? `<label class="check-field"><input type="checkbox" id="share-guest"><span>${t("Guest invitation for people outside the organization")}<small>${t("Guests are marked in the participant list and their access can expire.")}</small></span></label>` : ""}${frames.length ? `<label class="field">${t("Link opens")}<select id="share-scope"><option value="">${t("The entire board")}</option>${frames.map((f) => `<option value="${escape(f.id)}">${escape(labelled(t("Section"), f.text || t("Untitled frame")))}</option>`).join("")}</select></label>` : ""}`;
    },
    async settings() {
      const s = session();
      if (!s) return;
      if (!canManage(s.role))
        return toast(
          "Only the board owner or a facilitator can change board settings.",
        );
      const inOrg = !!org.info?.configured && org.server === s.server;
      // Spaces and teams are organization member data; guests do not file
      // boards into them.
      const organize = inOrg && org.isMember;
      const optional = (promise) => promise.catch(() => null);
      // Settings still open without the optional lists.
      const [spaceList, teamList, memberList, latest] = await Promise.all([
        organize
          ? optional(org.request("spaces.list").then((r) => r.spaces))
          : [],
        organize
          ? optional(org.request("teams.list").then((r) => r.teams))
          : [],
        optional(s.request("members").then((r) => r.members)),
        optional(s.request("settings.get").then((r) => r.settings)),
      ]);
      // The person may have left this board while the lists loaded; the
      // dialog would then act on a board that is no longer open.
      if (s.closed || session() !== s) return;
      const spaces = spaceList || [],
        teams = teamList || [],
        members = memberList || [];
      if (latest) s.settings = { ...s.settings, ...latest };
      const current = s.settings || {
        visibility: "private",
        orgRole: "editor",
        linkRole: "viewer",
      };
      // Only send the space and team when their current values and choices
      // are known, so saving other settings never clears them.
      const organizeKnown = !!(latest && spaceList && teamList);
      // What the form showed when it opened, or last saved.
      const shown = {
        visibility: current.visibility,
        orgRole: current.orgRole,
        linkRole: current.linkRole,
      };
      const policy = org.policy();
      const linksAllowed =
        !inOrg || (policy?.publicLinks && policy?.externalSharing === "anyone");
      const owner = s.role === "owner";
      modal(
        "Board settings",
        `<form id="board-settings" class="policy-form"><fieldset><legend>${t("Who can open this board")}</legend>${[
          ["private", "Only invited people"],
          ...(inOrg ? [["organization", "Everyone in the organization"]] : []),
          ["link", "Anyone signed in with the link"],
        ]
          .map(
            ([v, l]) =>
              `<label class="check-field"><input type="radio" name="bs-visibility" value="${v}" ${current.visibility === v ? "checked" : ""} ${v === "link" && !linksAllowed ? "disabled" : ""}><span>${t(l)}${v === "link" && !linksAllowed ? `<small>${t("Your organization does not allow public board links.")}</small>` : ""}</span></label>`,
          )
          .join(
            "",
          )}<label class="field">${t("Role for organization members")}<select id="bs-org-role">${["editor", "commenter", "viewer"].map((r) => `<option value="${r}" ${current.orgRole === r ? "selected" : ""}>${t(ROLE_LABELS[r])}</option>`).join("")}</select></label><label class="field">${t("Role for people with the link")}<select id="bs-link-role">${["editor", "commenter", "viewer"].map((r) => `<option value="${r}" ${current.linkRole === r ? "selected" : ""}>${t(ROLE_LABELS[r])}</option>`).join("")}</select></label></fieldset>${organize ? `<fieldset><legend>${t("Organize")}</legend><label class="field">${t("Space")}<select id="bs-space"><option value="">${t("None")}</option>${spaces.map((sp) => `<option value="${escape(sp.id)}" ${current.space === sp.id ? "selected" : ""} data-user-content>${escape(sp.name)}</option>`).join("")}</select></label><label class="field">${t("Team")}<select id="bs-team"><option value="">${t("None")}</option>${teams.map((tm) => `<option value="${escape(tm.id)}" ${current.team === tm.id ? "selected" : ""} data-user-content>${escape(tm.name)}</option>`).join("")}</select></label>${org.allows("slack") && latest?.integrations ? `<label class="field">${t("Slack channel webhook for mentions (optional)")} ${latest.slack ? `<span class="badge">${t("Connected")}</span>` : ""}<input id="bs-slack" type="url" placeholder="https://hooks.slack.com/services/…" autocomplete="off"></label>${latest.slack ? `<label class="check-field"><input type="checkbox" id="bs-slack-off"><span>${t("Disconnect Slack")}</span></label>` : ""}` : ""}</fieldset>` : ""}<div class="dialog-footer"><button class="primary">${t("Save settings")}</button></div></form>${
          owner
            ? `<section class="policy-form"><h3>${t("Ownership and lifecycle")}</h3><div class="inline-form"><label class="field">${t("Transfer ownership to")}<select id="bs-transfer"><option value="">${t("Choose a member")}</option>${members
                .filter(
                  (m) =>
                    m.role !== "owner" &&
                    m.role !== "removed" &&
                    !m.guest &&
                    !m.inactive,
                )
                .map(
                  (m) =>
                    `<option value="${escape(m.uuid)}" data-user-content>${escape(m.username || m.uuid)}</option>`,
                )
                .join(
                  "",
                )}</select></label><button class="secondary" id="bs-transfer-go">${t("Transfer")}</button></div><div class="dialog-footer"><button class="secondary" id="bs-archive">${icon("archive")}${t(current.archived ? "Unarchive board" : "Archive board")}</button><button class="text-btn danger" id="bs-delete">${t("Delete board for everyone")}</button></div></section>`
            : ""
        }<p id="bs-status" role="status"></p>`,
        (d) => {
          const out = d.querySelector("#bs-status");
          // Where the board is filed as shown, compared on saving.
          const filed = {
            space: d.querySelector("#bs-space")?.value,
            team: d.querySelector("#bs-team")?.value,
          };
          const run = async (button, fn) => {
            const done = busy(button);
            try {
              await fn();
            } catch (error) {
              out.textContent = t(error.message);
            } finally {
              done();
            }
          };
          d.querySelector("#board-settings").onsubmit = (e) => {
            e.preventDefault();
            run(e.submitter, async () => {
              const chosen = {
                visibility: d.querySelector('[name="bs-visibility"]:checked')
                  ?.value,
                orgRole: d.querySelector("#bs-org-role").value,
                linkRole: d.querySelector("#bs-link-role").value,
              };
              // Only what was changed here is sent, so saving never undoes a
              // change someone else made while this dialog was open.
              const payload = Object.fromEntries(
                Object.entries(chosen).filter(
                  ([key, value]) => value !== undefined && value !== shown[key],
                ),
              );
              if (organizeKnown && d.querySelector("#bs-space"))
                for (const key of ["space", "team"]) {
                  const value = d.querySelector(`#bs-${key}`).value;
                  if (value !== filed[key]) payload[key] = value || null;
                }
              const slack = d.querySelector("#bs-slack")?.value;
              if (slack) payload.slack = slack;
              else if (d.querySelector("#bs-slack-off")?.checked)
                payload.slack = "";
              const { settings } = await s.request("settings", payload);
              s.settings = settings;
              Object.assign(shown, chosen);
              out.textContent = t("Settings saved.");
              toast("Board settings saved.");
            });
          };
          d.querySelector("#bs-transfer-go")?.addEventListener("click", (e) =>
            run(e.currentTarget, async () => {
              const uuid = d.querySelector("#bs-transfer").value;
              if (!uuid) throw Error(t("Choose a member."));
              await s.request("transfer", { uuid });
              await s.heartbeat?.();
              // Transfer, archive, and delete belong to the new owner now,
              // unless this person keeps owner rights as an administrator.
              if (s.role === "owner") {
                out.textContent = t("Ownership transferred.");
                return;
              }
              d.querySelector("#bs-transfer-go").closest("section").remove();
              d.querySelector("#board-settings .primary").focus();
              out.textContent = t(
                "Ownership transferred. You are now a facilitator.",
              );
            }),
          );
          d.querySelector("#bs-archive")?.addEventListener("click", (e) =>
            run(e.currentTarget, async () => {
              const { settings } = await s.request(
                current.archived ? "unarchive" : "archive",
              );
              s.settings = settings;
              // The board locks or unlocks now, not at the next check-in,
              // so no edit is made on an archived board and refused later.
              await s.heartbeat?.();
              d.close();
              toast(
                settings.archived
                  ? "Board archived. It is now read-only."
                  : "Board unarchived. It can be edited again.",
              );
            }),
          );
          const del = d.querySelector("#bs-delete");
          del?.addEventListener("click", (e) =>
            run(e.currentTarget, async () => {
              if (!del.dataset.confirm) {
                del.dataset.confirm = "1";
                del.textContent = t("Select again to delete for everyone");
                // The renamed button keeps focus, so say what it now asks.
                out.textContent = t("Select again to delete for everyone");
                return;
              }
              await s.request("delete");
              d.close();
              toast(
                "Board deleted. An administrator can restore it during the retention period.",
              );
              home();
            }),
          );
          refresh();
        },
      );
    },
  };
  return api;
}

addTranslations({
  Owner: "Propriétaire",
  Facilitator: "Animateur",
  "Can edit": "Peut modifier",
  "Can comment": "Peut commenter",
  "Can view": "Peut consulter",
  Removed: "Retiré",
  "Guest invitation for people outside the organization":
    "Invitation d’invité pour les personnes de l’extérieur de l’organisation",
  "Guests are marked in the participant list and their access can expire.":
    "Les invités sont signalés dans la liste des participants et leur accès peut expirer.",
  "Link opens": "Le lien ouvre",
  "The entire board": "Le tableau entier",
  Section: "Section",
  "Untitled frame": "Cadre sans titre",
  "Only the board owner or a facilitator can change board settings.":
    "Seuls le propriétaire du tableau ou un animateur peuvent modifier les paramètres du tableau.",
  "Board settings": "Paramètres du tableau",
  "Who can open this board": "Qui peut ouvrir ce tableau",
  "Only invited people": "Seulement les personnes invitées",
  "Everyone in the organization": "Tout le monde dans l’organisation",
  "Anyone signed in with the link": "Toute personne connectée ayant le lien",
  "Your organization does not allow public board links.":
    "Votre organisation n’autorise pas les liens publics vers les tableaux.",
  "Role for organization members": "Rôle des membres de l’organisation",
  "Role for people with the link": "Rôle des personnes ayant le lien",
  Organize: "Organiser",
  Space: "Espace",
  Team: "Équipe",
  None: "Aucun",
  "Slack channel webhook for mentions (optional)":
    "Webhook du canal Slack pour les mentions (facultatif)",
  Connected: "Connecté",
  "Disconnect Slack": "Déconnecter Slack",
  "Save settings": "Enregistrer les paramètres",
  "Ownership and lifecycle": "Propriété et cycle de vie",
  "Transfer ownership to": "Transférer la propriété à",
  "Choose a member": "Choisir un membre",
  Transfer: "Transférer",
  "Unarchive board": "Désarchiver le tableau",
  "Archive board": "Archiver le tableau",
  "Delete board for everyone": "Supprimer le tableau pour tout le monde",
  "Settings saved.": "Paramètres enregistrés.",
  "Board settings saved.": "Paramètres du tableau enregistrés.",
  "Choose a member.": "Choisissez un membre.",
  "Ownership transferred. You are now a facilitator.":
    "Propriété transférée. Vous animez maintenant ce tableau.",
  "Ownership transferred.": "Propriété transférée.",
  "Board archived. It is now read-only.":
    "Tableau archivé. Il est maintenant en lecture seule.",
  "Board unarchived. It can be edited again.":
    "Tableau désarchivé. Il peut de nouveau être modifié.",
  "Select again to delete for everyone":
    "Sélectionnez de nouveau pour supprimer pour tout le monde",
  "Board deleted. An administrator can restore it during the retention period.":
    "Tableau supprimé. Un administrateur peut le restaurer pendant la période de conservation.",
  Guest: "Invité",
});
