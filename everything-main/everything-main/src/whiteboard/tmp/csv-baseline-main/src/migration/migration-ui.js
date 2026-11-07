import { escape } from "../model.js";
import { t as translate, addTranslations } from "../i18n.js";
import { createMiroClient } from "./miro-client.js";
import { formatIssue, reportTotals } from "./miro-convert.js";
import {
  loadInventory,
  summarizeInventory,
  planPhases,
  createLog,
  parseLog,
  parseDomains,
  parseEmailMap,
  runMigration,
  rollbackBoards,
  rollbackTargets,
  logEntry,
  logToCSV,
  logToJSON,
  inventoryToCSV,
} from "./miro-plan.js";

addTranslations({
  "Migrate from Miro": "Migrer depuis Miro",
  "Copy boards, frames, sticky notes, shapes, connectors, images, tags, and member roles from Miro. Start with a dry run to review the report; nothing is saved until you migrate.":
    "Copiez les tableaux, cadres, notes adhésives, formes, connecteurs, images, étiquettes et rôles des membres depuis Miro. Commencez par un essai pour examiner le rapport; rien n’est enregistré avant la migration.",
  "Miro access token": "Jeton d’accès Miro",
  "Use a token with boards:read access (and organizations:read for directory data). It stays in this browser tab and is never saved.":
    "Utilisez un jeton avec l’accès boards:read (et organizations:read pour l’annuaire). Il reste dans cet onglet et n’est jamais enregistré.",
  "Keep the token in memory until this page is closed":
    "Garder le jeton en mémoire jusqu’à la fermeture de cette page",
  "Miro organization ID (optional)":
    "Identifiant d’organisation Miro (facultatif)",
  "Enterprise plans only. Adds teams and member email addresses.":
    "Forfaits Enterprise seulement. Ajoute les équipes et les adresses courriel des membres.",
  "Organization email domains": "Domaines de courriel de l’organisation",
  "Separate domains with commas. People with other addresses are marked as guests.":
    "Séparez les domaines par des virgules. Les personnes ayant d’autres adresses sont désignées comme invitées.",
  "Owner and email options": "Options de propriétaire et de courriel",
  "User email mapping (optional)":
    "Correspondance des adresses courriel (facultatif)",
  "One person per line: Miro user ID, email address.":
    "Une personne par ligne : identifiant Miro, adresse courriel.",
  "Fallback owner email": "Courriel du propriétaire de rechange",
  "Used when a board owner’s email address is unknown.":
    "Utilisé lorsque l’adresse courriel du propriétaire est inconnue.",
  "Load boards": "Charger les tableaux",
  "Miro boards": "Tableaux Miro",
  "Group phases by": "Regrouper les phases par",
  Team: "Équipe",
  Owner: "Propriétaire",
  "Board count": "Nombre de tableaux",
  "Boards per phase": "Tableaux par phase",
  Phase: "Phase",
  "All boards ({count})": "Tous les tableaux ({count})",
  "Phase {n}: {label} ({count})": "Phase {n} : {label} ({count})",
  "No team": "Aucune équipe",
  "Unknown owner": "Propriétaire inconnu",
  Batch: "Lot",
  "Filter boards": "Filtrer les tableaux",
  "Select shown": "Sélectionner les tableaux affichés",
  "Clear selection": "Effacer la sélection",
  "{selected} of {total} boards selected":
    "{selected} tableaux sélectionnés sur {total}",
  "Showing {shown} of {total} boards. Refine the filter to see more.":
    "{shown} tableaux affichés sur {total}. Précisez le filtre pour en voir davantage.",
  "No boards match this filter.": "Aucun tableau ne correspond à ce filtre.",
  "Import as template": "Importer comme modèle",
  "unsupported resource URL": "adresse de ressource non prise en charge",
  "missing resource URL": "adresse de ressource manquante",
  "file too large": "fichier trop volumineux",
  "too many redirects": "trop de redirections",
  "empty download": "téléchargement vide",
  "larger than 5 MB": "plus de 5 Mo",
  "larger than 10 MB": "plus de 10 Mo",
  "board over 100 MB": "tableau de plus de 100 Mo",
  "unsupported format": "format non pris en charge",
  "unreadable image": "image illisible",
  "more than 40 million pixels": "plus de 40 millions de pixels",
  "no downloader": "aucun téléchargeur",
  "missing image URL": "adresse de l’image manquante",
  "Migration stopped. Boards already migrated are kept in the log.":
    "Migration arrêtée. Les tableaux déjà migrés restent dans le journal.",
  "Rollback stopped. Boards not rolled back yet are kept in the log.":
    "Annulation arrêtée. Les tableaux dont la migration n’est pas encore annulée restent dans le journal.",
  "The migration log could not be loaded from your Puter drive. Close and reopen this dialog to try again before migrating or rolling back.":
    "Le journal de migration n’a pas pu être chargé depuis votre espace Puter. Fermez et rouvrez cette fenêtre pour réessayer avant de migrer ou d’annuler.",
  "Templates are saved to an organization library.":
    "Les modèles sont enregistrés dans la bibliothèque d’une organisation.",
  "Migrate again even if already migrated":
    "Migrer de nouveau même si déjà migré",
  "Dry run": "Essai",
  "Migrate selected": "Migrer la sélection",
  "Roll back phase": "Annuler la migration de la phase",
  "Confirm rollback of {count} board":
    "Confirmer l’annulation de {count} tableau",
  "Confirm rollback of {count} boards":
    "Confirmer l’annulation de {count} tableaux",
  "Download CSV report": "Télécharger le rapport CSV",
  "Download JSON report": "Télécharger le rapport JSON",
  "Download inventory": "Télécharger l’inventaire",
  "Migration progress": "Progression de la migration",
  "Migration results": "Résultats de la migration",
  "Enter a Miro access token.": "Saisissez un jeton d’accès Miro.",
  "Check email mapping lines: {lines}":
    "Vérifiez les lignes de correspondance des courriels : {lines}",
  "Without organization domains, guest users cannot be identified.":
    "Sans domaines d’organisation, les utilisateurs invités ne peuvent pas être repérés.",
  "Listing boards: {loaded} found": "Liste des tableaux : {loaded} trouvés",
  "Reading the organization directory…":
    "Lecture de l’annuaire de l’organisation…",
  "Reading members: {loaded} of {total} boards":
    "Lecture des membres : {loaded} tableaux sur {total}",
  "{boards} boards, {users} people ({guests} guests, {unresolved} without email), {teams} teams, {items} items.":
    "{boards} tableaux, {users} personnes ({guests} invités, {unresolved} sans courriel), {teams} équipes, {items} éléments.",
  "The organization directory is unavailable (Enterprise plan and organizations:read are required). Some owner emails may be missing.":
    "L’annuaire de l’organisation n’est pas accessible (forfait Enterprise et organizations:read requis). Certaines adresses de propriétaires peuvent manquer.",
  "The board's members could not be read from Miro. Load the boards again, then migrate it.":
    "Les membres du tableau n’ont pas pu être lus dans Miro. Chargez de nouveau les tableaux, puis migrez-le.",
  "Members could not be read": "Membres illisibles",
  "Finishing the migration that was stopped…":
    "Fin de la migration qui a été arrêtée…",
  "{count} board could not be read completely.":
    "{count} tableau n’a pas pu être lu au complet.",
  "{count} boards could not be read completely.":
    "{count} tableaux n’ont pas pu être lus au complet.",
  "Miro asked to slow down. Retrying in {seconds} s.":
    "Miro demande de ralentir. Nouvel essai dans {seconds} s.",
  "Miro could not be reached. Retrying in {seconds} s.":
    "Impossible de joindre Miro. Nouvel essai dans {seconds} s.",
  "Board {index} of {total}": "Tableau {index} sur {total}",
  "Reading board content": "Lecture du contenu du tableau",
  "Converting and copying images": "Conversion et copie des images",
  "Saving board": "Enregistrement du tableau",
  "Select at least one board.": "Sélectionnez au moins un tableau.",
  "Migration cancelled. Completed boards remain in the log.":
    "Migration annulée. Les tableaux terminés restent dans le journal.",
  "Dry run complete: {ok} ready, {failed} with errors.":
    "Essai terminé : {ok} prêts, {failed} avec erreurs.",
  "Migration complete: {migrated} migrated, {failed} failed, {skipped} already migrated.":
    "Migration terminée : {migrated} migrés, {failed} en échec, {skipped} déjà migrés.",
  "Rollback complete: {done} board removed, {failed} failed.":
    "Annulation terminée : {done} tableau supprimé, {failed} en échec.",
  "Rollback complete: {done} boards removed, {failed} failed.":
    "Annulation terminée : {done} tableaux supprimés, {failed} en échec.",
  "Nothing to roll back in this phase.":
    "Aucune migration à annuler dans cette phase.",
  "Rolling back {index} of {total}": "Annulation {index} sur {total}",
  "The saved migration log could not be read. A new log will be started.":
    "Le journal de migration enregistré est illisible. Un nouveau journal sera créé.",
  "Ready to migrate": "Prêt à migrer",
  Migrated: "Migré",
  Failed: "Échec",
  "Rolled back": "Migration annulée",
  Pending: "En attente",
  "Already migrated": "Déjà migré",
  "Not migrated": "Non migré",
  "Owner email unknown": "Courriel du propriétaire inconnu",
  "{count} item": "{count} élément",
  "{count} items": "{count} éléments",
  "{count} guest": "{count} invité",
  "{count} guests": "{count} invités",
  "{converted} of {source} objects converted, {skipped} skipped, {warnings} warnings":
    "{converted} objets convertis sur {source}, {skipped} ignorés, {warnings} avertissements",
  "Report details": "Détails du rapport",
  "Object type": "Type d’objet",
  "In Miro": "Dans Miro",
  Converted: "Converti",
  "…and {count} more": "…et {count} autres",
  "Sticky notes": "Notes adhésives",
  Shapes: "Formes",
  Frames: "Cadres",
  Images: "Images",
  Cards: "Cartes",
  "App cards": "Cartes d’application",
  Documents: "Documents",
  Embeds: "Contenus intégrés",
  "Link previews": "Aperçus de liens",
  Connectors: "Connecteurs",
  Tags: "Étiquettes",
  Assignee: "Responsable",
  Due: "Échéance",
  Status: "État",
  "Image not migrated": "Image non migrée",
  Document: "Document",
  "Miro could not be reached. Check the connection.":
    "Impossible de joindre Miro. Vérifiez la connexion.",
  "The Miro access token was rejected. Create a new token and try again.":
    "Le jeton d’accès Miro a été refusé. Créez un nouveau jeton et réessayez.",
  "The Miro token does not have permission for this request.":
    "Le jeton Miro n’a pas l’autorisation requise pour cette demande.",
  "The Miro resource was not found.": "La ressource Miro est introuvable.",
  "Miro rate limits were exceeded. Try again later.":
    "Les limites de débit de Miro ont été dépassées. Réessayez plus tard.",
  "Miro returned an error ({status}).": "Miro a renvoyé une erreur ({status}).",
  "The board could not be created.": "Le tableau n’a pas pu être créé.",
  "The migration log could not be saved. The run was stopped so no board is left untracked.":
    "Le journal de migration n’a pas pu être enregistré. L’opération a été arrêtée pour qu’aucun tableau ne reste sans suivi.",
  "The migration log could not be saved, so the run was stopped. The board copied from {name} ({id}) is not in the saved log; download the report to keep a record of it.":
    "Le journal de migration n’a pas pu être enregistré, l’opération a donc été arrêtée. Le tableau copié depuis {name} ({id}) ne figure pas dans le journal enregistré; téléchargez le rapport pour en garder une trace.",
  "The migration log could not be saved. The rollback was stopped so no board is left untracked.":
    "Le journal de migration n’a pas pu être enregistré. L’annulation a été arrêtée pour qu’aucun tableau ne reste sans suivi.",
  "The migration log could not be read.":
    "Le journal de migration est illisible.",
  "Unsupported Miro item type: {type}.":
    "Type d’élément Miro non pris en charge : {type}.",
  "The object is outside the supported board area.":
    "L’objet se trouve hors de la zone prise en charge du tableau.",
  "The object could not be converted: {reason}":
    "L’objet n’a pas pu être converti : {reason}",
  "Shape {shape} was approximated as {target}.":
    "La forme {shape} a été remplacée par une forme proche ({target}).",
  "Unknown shape {shape} became a rectangle.":
    "La forme inconnue {shape} est devenue un rectangle.",
  "Text was shortened to 20,000 characters.":
    "Le texte a été raccourci à 20 000 caractères.",
  "Rotation is not supported for this object type.":
    "La rotation n’est pas prise en charge pour ce type d’objet.",
  "This board was migrated to another device. Roll it back on that device.":
    "Ce tableau a été migré vers un autre appareil. Annulez la migration sur cet appareil.",
  "A shape without a fill became white and was placed behind other objects.":
    "Une forme sans remplissage est devenue blanche et a été placée derrière les autres objets.",
  "Image {title} could not be copied ({reason}). A placeholder was added.":
    "L’image {title} n’a pas pu être copiée ({reason}). Un espace réservé a été ajouté.",
  "Document {title} was added as a link; its file was not copied.":
    "Le document {title} a été ajouté comme lien; son fichier n’a pas été copié.",
  "Document {title} could not be copied ({reason}). A link was added instead.":
    "Le document {title} n’a pas pu être copié ({reason}). Un lien a été ajouté à la place.",
  "Link {url} is not a web address. A text card was added.":
    "Le lien {url} n’est pas une adresse Web. Une carte de texte a été ajoutée.",
  "Only the first 8 tags were kept on an object.":
    "Seules les 8 premières étiquettes d’un objet ont été conservées.",
  "Tags are kept only on sticky notes.":
    "Les étiquettes sont conservées seulement sur les notes adhésives.",
  "An object referenced a tag that is not on the board.":
    "Un objet faisait référence à une étiquette absente du tableau.",
  "Only the first 1,000 board tags were kept.":
    "Seules les 1 000 premières étiquettes du tableau ont été conservées.",
  "Tag {name} duplicated another tag and was merged.":
    "L’étiquette {name} en doublait une autre et a été fusionnée.",
  "A tag without a usable name was skipped.":
    "Une étiquette sans nom utilisable a été ignorée.",
  "A frame inside another frame kept its position but is no longer nested.":
    "Un cadre placé dans un autre cadre a gardé sa position, mais n’y est plus imbriqué.",
  "An object's parent was not found; its position may be approximate.":
    "Le parent d’un objet est introuvable; sa position peut être approximative.",
  "A connector attached to a frame now has a free endpoint.":
    "Un connecteur relié à un cadre a maintenant une extrémité libre.",
  "A connector endpoint was not migrated and is now free.":
    "Une extrémité de connecteur n’a pas été migrée et est maintenant libre.",
  "Connectors from an object to itself are not supported.":
    "Les connecteurs d’un objet vers lui-même ne sont pas pris en charge.",
  "Neither connector endpoint could be placed.":
    "Aucune extrémité du connecteur n’a pu être placée.",
  "Several connector captions were combined into one.":
    "Plusieurs légendes de connecteur ont été combinées en une seule.",
  "Line end {cap} was approximated.":
    "L’extrémité de ligne {cap} a été remplacée par une extrémité proche.",
  "This board has {count} objects after conversion; boards support up to 5,000. Split it in Miro (for example by frame) and migrate the parts.":
    "Ce tableau compte {count} objets après conversion; les tableaux en acceptent au plus 5 000. Divisez-le dans Miro (par exemple par cadre) et migrez les parties.",
  "The converted board is about {size} MB; boards over 100 MB may not open or export.":
    "Le tableau converti pèse environ {size} Mo; les tableaux de plus de 100 Mo pourraient ne pas s’ouvrir ni s’exporter.",
  "The converted board failed validation: {reason}":
    "Le tableau converti n’a pas passé la validation : {reason}",
});

const TYPE_LABELS = {
  sticky_note: "Sticky notes",
  text: "Text",
  shape: "Shapes",
  frame: "Frames",
  image: "Images",
  card: "Cards",
  app_card: "App cards",
  document: "Documents",
  embed: "Embeds",
  preview: "Link previews",
  connector: "Connectors",
  tag: "Tags",
};
const STATUS_LABELS = {
  pending: "Pending",
  migrated: "Migrated",
  failed: "Failed",
  "rolled-back": "Rolled back",
  skipped: "Already migrated",
  "dry-run": "Ready to migrate",
};
const ROW_LIMIT = 200;
const ISSUE_LIMIT = 20;

function browserDownload(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Dependencies (all functions are supplied by the host; none call Puter here):
//   modal(title, html, onReady), toast(message), t(text), fetch(url, init)
//   createBoard(board, { ownerEmail, members, source, asTemplate, signal })
//     resolves to { id }; deleteBoard(id); saveLog(json); loadLog() resolves
//   to the saved JSON text or object (or null); optional download(name, text,
//   type) and sleep(ms, signal).
const LOG_UNAVAILABLE =
  "The migration log could not be loaded from your Puter drive. Close and reopen this dialog to try again before migrating or rolling back.";
export function createMiroMigration(deps) {
  const t = deps.t || translate;
  const fmt = (text, params = {}) =>
    t(text).replace(/\{(\w+)\}/g, (_, key) => params[key] ?? "");
  // A count of one takes the singular message.
  const counted = (count, one, many) =>
    fmt(count === 1 ? one : many, { count });
  const download = deps.download || browserDownload;
  // Held only for this page when the user opts in; never written to storage.
  let rememberedToken = "";
  // A run keeps going briefly after its dialog closes, until the board it
  // is saving is created and logged. A dialog opened meanwhile reads the log
  // only after that, so it never copies the board again or loses its entry.
  let running = null;
  const track = (work) => {
    const settled = work.then(
      () => {},
      () => {},
    );
    running = settled;
    settled.then(() => {
      if (running === settled) running = null;
    });
    return work;
  };

  // Translates a message, including Miro errors that name a status code and
  // a stopped run that names the board it could not log. Report issues use
  // it too, so their reasons read in the same language.
  function messageText(message) {
    const m = /^Miro returned an error \((\d+)\)\.$/.exec(message);
    if (m) return fmt("Miro returned an error ({status}).", { status: m[1] });
    const u =
      /^The migration log could not be saved, so the run was stopped\. The board copied from (.*) \(([^()]*)\) is not in the saved log; download the report to keep a record of it\.$/s.exec(
        message,
      );
    return u
      ? fmt(
          "The migration log could not be saved, so the run was stopped. The board copied from {name} ({id}) is not in the saved log; download the report to keep a record of it.",
          { name: u[1], id: u[2] },
        )
      : t(message);
  }
  const errorText = (error) => messageText(error?.message || String(error));

  function open() {
    deps.modal(
      t("Migrate from Miro"),
      `<form id="miro-connect" class="miro-migration">
        <p class="dialog-copy">${t("Copy boards, frames, sticky notes, shapes, connectors, images, tags, and member roles from Miro. Start with a dry run to review the report; nothing is saved until you migrate.")}</p>
        <label class="field">${t("Miro access token")}<input id="miro-token" type="password" autocomplete="off" spellcheck="false" aria-describedby="miro-token-help" required></label>
        <p class="dialog-copy" id="miro-token-help">${t("Use a token with boards:read access (and organizations:read for directory data). It stays in this browser tab and is never saved.")}</p>
        <label class="check-row"><input type="checkbox" id="miro-remember">${t("Keep the token in memory until this page is closed")}</label>
        <div class="field-row"><label class="field">${t("Miro organization ID (optional)")}<input id="miro-org" autocomplete="off" aria-describedby="miro-org-help"></label>
        <label class="field">${t("Organization email domains")}<input id="miro-domains" placeholder="canada.ca, gc.ca" autocomplete="off" aria-describedby="miro-domains-help"></label></div>
        <p class="dialog-copy" id="miro-org-help">${t("Enterprise plans only. Adds teams and member email addresses.")}</p>
        <p class="dialog-copy" id="miro-domains-help">${t("Separate domains with commas. People with other addresses are marked as guests.")}</p>
        <details><summary>${t("Owner and email options")}</summary>
          <label class="field">${t("User email mapping (optional)")}<textarea id="miro-email-map" rows="3" spellcheck="false" aria-describedby="miro-email-map-help"></textarea></label>
          <p class="dialog-copy" id="miro-email-map-help">${t("One person per line: Miro user ID, email address.")}</p>
          <label class="field">${t("Fallback owner email")}<input id="miro-fallback-owner" type="email" autocomplete="off" aria-describedby="miro-fallback-help"></label>
          <p class="dialog-copy" id="miro-fallback-help">${t("Used when a board owner’s email address is unknown.")}</p>
        </details>
        <div class="dialog-footer"><button class="primary" type="submit" id="miro-load">${t("Load boards")}</button></div>
      </form>
      <section id="miro-inventory" aria-labelledby="miro-inventory-heading" hidden>
        <h3 id="miro-inventory-heading" tabindex="-1">${t("Miro boards")}</h3>
        <p class="dialog-copy" id="miro-summary"></p>
        <div class="field-row">
          <label class="field">${t("Group phases by")}<select id="miro-phase-by"><option value="team">${t("Team")}</option><option value="owner">${t("Owner")}</option><option value="count">${t("Board count")}</option></select></label>
          <label class="field">${t("Boards per phase")}<input id="miro-phase-size" type="number" min="1" max="1000" value="50"></label>
          <label class="field">${t("Phase")}<select id="miro-phase"></select></label>
        </div>
        <label class="field">${t("Filter boards")}<input id="miro-filter" type="search" autocomplete="off"></label>
        <div class="dialog-footer"><button type="button" class="secondary" id="miro-select-all">${t("Select shown")}</button><button type="button" class="secondary" id="miro-select-none">${t("Clear selection")}</button></div>
        <p class="dialog-copy" id="miro-selection" role="status" aria-live="polite"></p>
        <div id="miro-board-list" class="slide-choices" role="group" aria-label="${escape(t("Miro boards"))}"></div>
        ${deps.canTemplate?.() === false ? "" : `<label class="check-row"><input type="checkbox" id="miro-template">${t("Import as template")}</label>`}
        <label class="check-row"><input type="checkbox" id="miro-force">${t("Migrate again even if already migrated")}</label>
        <div class="dialog-footer">
          <button type="button" class="secondary" id="miro-dry-run">${t("Dry run")}</button>
          <button type="button" class="primary" id="miro-run">${t("Migrate selected")}</button>
        </div>
        <div class="dialog-footer">
          <button type="button" class="secondary" id="miro-inventory-csv">${t("Download inventory")}</button>
          <button type="button" class="secondary" id="miro-csv">${t("Download CSV report")}</button>
          <button type="button" class="secondary" id="miro-json">${t("Download JSON report")}</button>
          <button type="button" class="secondary" id="miro-rollback">${t("Roll back phase")}</button>
        </div>
      </section>
      <progress id="miro-progress" max="1" value="0" aria-label="${escape(t("Migration progress"))}" hidden></progress>
      <p class="dialog-copy" id="miro-status" role="status" aria-live="polite"></p>
      <p class="dialog-copy" id="miro-error" role="alert"></p>
      <div class="dialog-footer"><button type="button" class="secondary" id="miro-cancel" hidden>${t("Cancel")}</button></div>
      <ul id="miro-results" class="revision-list" aria-label="${escape(t("Migration results"))}"></ul>`,
      (d) => setup(d),
    );
  }

  function setup(d) {
    const $ = (selector) => d.querySelector(selector);
    const state = {
      client: null,
      inventory: null,
      phases: [],
      phaseId: "all",
      selected: new Set(),
      controller: null,
      task: "",
      log: createLog(deps.now),
    };
    const status = (text) => ($("#miro-status").textContent = text);
    const fail = (text) => ($("#miro-error").textContent = text);
    const unreadable = () =>
      fail(
        t(
          "The saved migration log could not be read. A new log will be started.",
        ),
      );
    const waiting = !!running;
    if (waiting) status(t("Finishing the migration that was stopped…"));
    const logReady = Promise.resolve(running)
      .then(() => {
        if (waiting) status("");
        return deps.loadLog?.();
      })
      .then(
        (saved) => {
          if (!saved) return;
          try {
            state.log = parseLog(saved);
          } catch {
            unreadable();
          }
        },
        () => {
          // Migrating now would copy boards again and replace the saved log.
          state.logUnavailable = true;
          fail(t(LOG_UNAVAILABLE));
        },
      )
      .then(() => state.inventory && renderBoards());
    // Unticking the box forgets the token straight away.
    $("#miro-remember").addEventListener("change", (e) => {
      if (!e.target.checked) rememberedToken = "";
    });
    if (rememberedToken) {
      $("#miro-token").value = rememberedToken;
      $("#miro-remember").checked = true;
    }

    const actions = [
      "#miro-load",
      "#miro-dry-run",
      "#miro-run",
      "#miro-rollback",
      "#miro-phase-by",
      "#miro-phase-size",
      "#miro-phase",
    ];
    // The task names a migration or rollback, which change boards; loading
    // boards and dry runs change nothing and pass none.
    function busy(on, max = 1, task = "") {
      state.task = on ? task : "";
      for (const s of actions) if ($(s)) $(s).disabled = on;
      $("#miro-cancel").hidden = !on;
      const progress = $("#miro-progress");
      progress.hidden = !on;
      progress.max = Math.max(1, max);
      progress.value = 0;
      if (on) {
        state.controller = new AbortController();
        fail("");
        $("#miro-cancel").focus();
      } else {
        state.controller = null;
        // Keep focus inside the dialog when the Cancel button disappears.
        if (
          !d.contains(document.activeElement) ||
          !document.activeElement?.offsetParent
        )
          $(state.inventory ? "#miro-run" : "#miro-load")?.focus();
      }
      return state.controller?.signal;
    }
    const progress = (value, max) => {
      const bar = $("#miro-progress");
      if (max) bar.max = Math.max(1, max);
      bar.value = value;
    };
    $("#miro-cancel").onclick = () => state.controller?.abort();
    // A running migration or rollback is stopped only on purpose: Escape
    // and clicks outside the dialog are ignored, and closing it says what
    // happened. Other work simply stops when the dialog closes.
    d.addEventListener?.("cancel", (e) => {
      if (state.task) e.preventDefault();
    });
    d.addEventListener?.(
      "click",
      (e) => {
        if (state.task && e.target === d) e.stopImmediatePropagation();
      },
      true,
    );
    d.addEventListener?.("close", () => {
      state.controller?.abort();
      if (state.task === "migrate")
        deps.toast?.(
          t("Migration stopped. Boards already migrated are kept in the log."),
        );
      else if (state.task === "rollback")
        deps.toast?.(
          t(
            "Rollback stopped. Boards not rolled back yet are kept in the log.",
          ),
        );
      state.client = null;
    });

    const phaseBoards = () => {
      if (!state.inventory) return [];
      const phase = state.phases.find((p) => p.id === state.phaseId);
      if (!phase) return state.inventory.boards;
      const ids = new Set(phase.boardIds);
      return state.inventory.boards.filter((b) => ids.has(b.id));
    };
    const phaseName = (phase) =>
      phase.label ||
      t(
        phase.by === "owner"
          ? "Unknown owner"
          : phase.by === "count"
            ? "Batch"
            : "No team",
      );
    const phaseOf = (id) => {
      const phase = state.phases.find((p) => p.boardIds.includes(id));
      return phase
        ? `${phase.id}: ${phase.label || phase.by}${phase.parts > 1 ? ` (${phase.part}/${phase.parts})` : ""}`
        : "";
    };

    function renderPhases() {
      state.phases = planPhases(state.inventory.boards, {
        by: $("#miro-phase-by").value,
        size: $("#miro-phase-size").value,
      });
      if (!state.phases.some((p) => p.id === state.phaseId))
        state.phaseId = "all";
      $("#miro-phase").innerHTML = [
        `<option value="all">${escape(fmt("All boards ({count})", { count: state.inventory.boards.length }))}</option>`,
        ...state.phases.map(
          (p) =>
            `<option value="${p.id}">${escape(
              fmt("Phase {n}: {label} ({count})", {
                n: p.index,
                label: `${phaseName(p)}${p.parts > 1 ? ` ${p.part}/${p.parts}` : ""}`,
                count: p.boardIds.length,
              }),
            )}</option>`,
        ),
      ].join("");
      $("#miro-phase").value = state.phaseId;
      selectPhase();
    }
    function selectPhase() {
      state.phaseId = $("#miro-phase").value;
      state.selected = new Set(phaseBoards().map((b) => b.id));
      resetRollback();
      renderBoards();
    }
    function shownBoards() {
      const query = $("#miro-filter").value.trim().toLowerCase();
      return phaseBoards().filter(
        (b) =>
          !query ||
          [b.name, b.ownerEmail, b.owner?.name, b.teamName]
            .filter(Boolean)
            .some((v) => v.toLowerCase().includes(query)),
      );
    }
    function renderBoards() {
      const boards = shownBoards(),
        rows = boards.slice(0, ROW_LIMIT);
      $("#miro-board-list").innerHTML = rows.length
        ? rows
            .map((b) => {
              const entry = logEntry(state.log, b.id);
              const meta = [
                b.ownerEmail || t("Owner email unknown"),
                b.teamName,
                b.itemCount != null &&
                  counted(b.itemCount, "{count} item", "{count} items"),
                b.guests &&
                  counted(b.guests, "{count} guest", "{count} guests"),
                b.error && t("Members could not be read"),
                t(STATUS_LABELS[entry?.status] || "Not migrated"),
              ]
                .filter(Boolean)
                .join(" · ");
              return `<label><input type="checkbox" data-board="${escape(b.id)}" ${state.selected.has(b.id) ? "checked" : ""}><span><span data-user-content>${escape(b.name)}</span> <small data-user-content>${escape(meta)}</small></span></label>`;
            })
            .join("") +
          (boards.length > rows.length
            ? `<p class="dialog-copy">${escape(fmt("Showing {shown} of {total} boards. Refine the filter to see more.", { shown: rows.length, total: boards.length }))}</p>`
            : "")
        : `<p class="dialog-copy">${t("No boards match this filter.")}</p>`;
      d.querySelectorAll("[data-board]").forEach((box) => {
        box.onchange = () => {
          if (box.checked) state.selected.add(box.dataset.board);
          else state.selected.delete(box.dataset.board);
          countSelection();
        };
      });
      countSelection();
    }
    function countSelection() {
      $("#miro-selection").textContent = fmt(
        "{selected} of {total} boards selected",
        { selected: state.selected.size, total: phaseBoards().length },
      );
    }
    $("#miro-phase-by").onchange = renderPhases;
    $("#miro-phase-size").onchange = renderPhases;
    $("#miro-phase").onchange = selectPhase;
    $("#miro-filter").oninput = renderBoards;
    $("#miro-select-all").onclick = () => {
      for (const b of shownBoards()) state.selected.add(b.id);
      renderBoards();
    };
    $("#miro-select-none").onclick = () => {
      state.selected.clear();
      renderBoards();
    };

    $("#miro-connect").onsubmit = async (event) => {
      event.preventDefault();
      fail("");
      const token = $("#miro-token").value.trim();
      if (!token) return fail(t("Enter a Miro access token."));
      const domains = parseDomains($("#miro-domains").value);
      const mapping = parseEmailMap($("#miro-email-map").value);
      if (mapping.invalid.length)
        return fail(
          fmt("Check email mapping lines: {lines}", {
            lines: mapping.invalid.join(", "),
          }),
        );
      rememberedToken = $("#miro-remember").checked ? token : "";
      state.client = createMiroClient({
        fetch: deps.fetch,
        token,
        sleep: deps.sleep,
        // Only a 429 is Miro asking to slow down; a dropped connection or a
        // server error is not.
        onRetry: ({ status: code, delay }) =>
          status(
            fmt(
              code === 429
                ? "Miro asked to slow down. Retrying in {seconds} s."
                : "Miro could not be reached. Retrying in {seconds} s.",
              { seconds: Math.ceil(delay / 1000) },
            ),
          ),
      });
      const signal = busy(true);
      try {
        const inventory = await loadInventory(state.client, {
          orgId: $("#miro-org").value.trim(),
          domains,
          emailMap: mapping.map,
          signal,
          onProgress: (p) => {
            if (p.stage === "boards")
              status(fmt("Listing boards: {loaded} found", p));
            else if (p.stage === "organization")
              status(t("Reading the organization directory…"));
            else {
              progress(p.loaded, p.total);
              status(fmt("Reading members: {loaded} of {total} boards", p));
            }
          },
        });
        await logReady;
        state.inventory = inventory;
        const summary = summarizeInventory(inventory);
        const notes = [
          fmt(
            "{boards} boards, {users} people ({guests} guests, {unresolved} without email), {teams} teams, {items} items.",
            summary,
          ),
        ];
        if (inventory.orgId && !inventory.org.members)
          notes.push(
            t(
              "The organization directory is unavailable (Enterprise plan and organizations:read are required). Some owner emails may be missing.",
            ),
          );
        if (!domains.length)
          notes.push(
            t(
              "Without organization domains, guest users cannot be identified.",
            ),
          );
        if (summary.errors)
          notes.push(
            counted(
              summary.errors,
              "{count} board could not be read completely.",
              "{count} boards could not be read completely.",
            ),
          );
        $("#miro-summary").textContent = notes.join(" ");
        $("#miro-inventory").hidden = false;
        busy(false);
        renderPhases();
        status(notes[0]);
        $("#miro-inventory-heading").focus();
      } catch (error) {
        busy(false);
        status("");
        if (!signal.aborted) fail(errorText(error));
      }
    };

    const labels = () => ({
      untitled: t("Untitled board"),
      assignee: t("Assignee"),
      due: t("Due"),
      status: t("Status"),
      imageUnavailable: t("Image not migrated"),
      document: t("Document"),
    });
    const users = () => {
      const result = {};
      for (const b of state.inventory.boards)
        for (const m of b.members)
          result[m.id] = { name: m.name, email: m.email };
      return result;
    };
    function renderResult(result) {
      const li = document.createElement("li");
      li.className = "revision-row";
      const parts = [t(STATUS_LABELS[result.status] || result.status)];
      if (result.report) {
        const totals = reportTotals(result.report);
        parts.push(
          fmt(
            "{converted} of {source} objects converted, {skipped} skipped, {warnings} warnings",
            totals,
          ),
        );
      }
      // A conversion error is worded from its report entry, whose values
      // would otherwise keep the whole message out of translation.
      const first = result.report?.errors?.[0];
      if (result.error)
        parts.push(
          first?.message === result.error
            ? formatIssue(first, messageText)
            : errorText({ message: result.error }),
        );
      let html = `<div><strong data-user-content>${escape(result.name)}</strong><small data-user-content>${escape(parts.join(" · "))}</small></div>`;
      const report = result.report;
      if (report) {
        const types = Object.keys(report.source);
        const issues = [
          ...report.errors,
          ...report.skipped,
          ...report.warnings,
        ];
        html += `<details><summary>${t("Report details")}</summary><table><thead><tr><th scope="col">${t("Object type")}</th><th scope="col">${t("In Miro")}</th><th scope="col">${t("Converted")}</th></tr></thead><tbody>${types
          .map(
            (type) =>
              `<tr><th scope="row">${escape(TYPE_LABELS[type] ? t(TYPE_LABELS[type]) : type)}</th><td>${report.source[type]}</td><td>${report.converted[type] || 0}</td></tr>`,
          )
          .join("")}</tbody></table>${
          issues.length
            ? `<ul data-user-content>${issues
                .slice(0, ISSUE_LIMIT)
                .map(
                  (issue) =>
                    `<li>${escape(formatIssue(issue, messageText))}</li>`,
                )
                .join("")}${
                issues.length > ISSUE_LIMIT
                  ? `<li>${escape(fmt("…and {count} more", { count: issues.length - ISSUE_LIMIT }))}</li>`
                  : ""
              }</ul>`
            : ""
        }</details>`;
      }
      li.innerHTML = html;
      $("#miro-results").append(li);
    }

    async function migrate(dryRun) {
      const boards = phaseBoards().filter((b) => state.selected.has(b.id));
      if (!boards.length) return fail(t("Select at least one board."));
      await logReady;
      if (!dryRun && state.logUnavailable) return fail(t(LOG_UNAVAILABLE));
      $("#miro-results").innerHTML = "";
      const signal = busy(true, boards.length, dryRun ? "" : "migrate");
      const stages = {
        fetch: "Reading board content",
        items: "Reading board content",
        connectors: "Reading board content",
        convert: "Converting and copying images",
        save: "Saving board",
      };
      try {
        const outcome = await track(
          runMigration({
            client: state.client,
            boards,
            log: state.log,
            createBoard: deps.createBoard,
            deleteBoard: deps.deleteBoard,
            saveLog: deps.saveLog,
            sleep: deps.sleep,
            signal,
            dryRun,
            force: $("#miro-force").checked,
            asTemplate: !!$("#miro-template")?.checked,
            fallbackOwnerEmail: $("#miro-fallback-owner").value.trim(),
            phaseOf,
            users: users(),
            convertOptions: { labels: labels() },
            now: deps.now,
            onProgress: (p) => {
              progress(p.index - (p.done ? 0 : 1), p.total);
              if (p.stage)
                status(
                  `${fmt("Board {index} of {total}", p)}: ${p.board.name} · ${t(stages[p.stage] || "Reading board content")}`,
                );
            },
          }),
        );
        outcome.results.forEach(renderResult);
        const n = (s) => outcome.results.filter((r) => r.status === s).length;
        busy(false);
        if (outcome.fatal) {
          fail(messageText(outcome.fatal));
          status(
            t(
              "Migration stopped. Boards already migrated are kept in the log.",
            ),
          );
        } else if (outcome.cancelled)
          status(t("Migration cancelled. Completed boards remain in the log."));
        else if (dryRun)
          status(
            fmt("Dry run complete: {ok} ready, {failed} with errors.", {
              ok: n("dry-run"),
              failed: n("failed"),
            }),
          );
        else {
          const message = fmt(
            "Migration complete: {migrated} migrated, {failed} failed, {skipped} already migrated.",
            {
              migrated: n("migrated"),
              failed: n("failed"),
              skipped: n("skipped"),
            },
          );
          status(message);
          deps.toast?.(message);
        }
      } catch (error) {
        busy(false);
        fail(errorText(error));
      }
      renderBoards();
    }
    $("#miro-dry-run").onclick = () => migrate(true);
    $("#miro-run").onclick = () => migrate(false);

    // Rollback deletes created boards, so it takes a second click.
    const rollback = $("#miro-rollback");
    function resetRollback() {
      delete rollback.dataset.confirm;
      rollback.textContent = t("Roll back phase");
      rollback.classList.remove("danger");
    }
    rollback.onclick = async () => {
      await logReady;
      if (state.logUnavailable) return fail(t(LOG_UNAVAILABLE));
      // All boards covers every migrated row in the log, including boards
      // Miro no longer lists.
      const boardIds =
        state.phaseId === "all" ? undefined : phaseBoards().map((b) => b.id);
      const targets = rollbackTargets(state.log, { boardIds });
      if (!targets.length) {
        resetRollback();
        return status(t("Nothing to roll back in this phase."));
      }
      // The confirmation covers the boards it named; if the phase gained or
      // lost boards since, ask again with the new count.
      const named = targets.join("\n");
      if (rollback.dataset.confirm !== named) {
        rollback.dataset.confirm = named;
        rollback.textContent = counted(
          targets.length,
          "Confirm rollback of {count} board",
          "Confirm rollback of {count} boards",
        );
        rollback.classList.add("danger");
        return;
      }
      resetRollback();
      $("#miro-results").innerHTML = "";
      const signal = busy(true, targets.length, "rollback");
      try {
        const outcome = await track(
          rollbackBoards({
            log: state.log,
            deleteBoard: deps.deleteBoard,
            saveLog: deps.saveLog,
            boardIds,
            signal,
            now: deps.now,
            onProgress: (p) => {
              progress(p.index - 1, p.total);
              status(fmt("Rolling back {index} of {total}", p));
            },
          }),
        );
        outcome.results.forEach(renderResult);
        busy(false);
        if (outcome.fatal) fail(t(outcome.fatal));
        const n = (s) => outcome.results.filter((r) => r.status === s).length;
        status(
          outcome.cancelled || outcome.fatal
            ? t(
                "Rollback stopped. Boards not rolled back yet are kept in the log.",
              )
            : fmt(
                n("rolled-back") === 1
                  ? "Rollback complete: {done} board removed, {failed} failed."
                  : "Rollback complete: {done} boards removed, {failed} failed.",
                {
                  done: n("rolled-back"),
                  failed: n("failed"),
                },
              ),
        );
      } catch (error) {
        busy(false);
        fail(errorText(error));
      }
      renderBoards();
    };

    const stamp = () =>
      new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 10);
    $("#miro-csv").onclick = async () => {
      await logReady;
      download(
        `miro-migration-${stamp()}.csv`,
        logToCSV(state.log),
        "text/csv",
      );
    };
    $("#miro-json").onclick = async () => {
      await logReady;
      download(
        `miro-migration-${stamp()}.json`,
        logToJSON(state.log),
        "application/json",
      );
    };
    $("#miro-inventory-csv").onclick = () =>
      state.inventory &&
      download(
        `miro-inventory-${stamp()}.csv`,
        inventoryToCSV(state.inventory),
        "text/csv",
      );
    $("#miro-token").focus();
  }

  return { open };
}
