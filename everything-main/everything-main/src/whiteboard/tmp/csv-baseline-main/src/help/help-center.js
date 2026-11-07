import { escape } from "../model.js";
import { addTranslations, t, language } from "../i18n.js";
import {
  createAuthoredField,
  trimmedFieldContent,
} from "../facilitation/authored-field.js";

// Role-based guides available offline in English and French. Each entry is
// [English, French]; the interface language chooses which one is shown.
export const GUIDES = [
  {
    role: "start",
    title: ["Create your first board", "Créer votre premier tableau"],
    body: [
      "Choose New board or a template from the library. Add sticky notes (N), text (T), shapes (S), arrows (A), and frames (F) from the toolbar, or drop images and files onto the board. Everything saves automatically; the status next to the board name shows when changes are saved.",
      "Choisissez Nouveau tableau ou un modèle de la bibliothèque. Ajoutez des notes adhésives (N), du texte (T), des formes (S), des flèches (A) et des cadres (F) à partir de la barre d’outils, ou déposez des images et des fichiers sur le tableau. Tout est enregistré automatiquement; l’état à côté du nom du tableau indique quand les modifications sont enregistrées.",
    ],
  },
  {
    role: "start",
    title: ["Move around large boards", "Se déplacer dans un grand tableau"],
    body: [
      "Pan with Space and drag, the Pan tool (H), or two fingers. Zoom with Ctrl/Cmd and the wheel, pinch, or the zoom controls. Frames and navigation works like a table of contents, the minimap (M) shows the whole board, and Find on board (Ctrl/Cmd F) searches text, tables, links, and files.",
      "Déplacez la vue avec Espace et un glisser, l’outil Déplacer (H) ou deux doigts. Zoomez avec Ctrl/Cmd et la molette, un pincement ou les commandes de zoom. Cadres et navigation fonctionne comme une table des matières, la mini-carte (M) montre tout le tableau et Rechercher sur le tableau (Ctrl/Cmd F) cherche dans le texte, les tableaux de données, les liens et les fichiers.",
    ],
  },
  {
    role: "start",
    title: ["Use the keyboard", "Utiliser le clavier"],
    body: [
      "Every tool has a shortcut, and Ctrl/Cmd K opens the command palette. Board objects lists every object so you can select and edit without a mouse. Tab moves between controls; Enter edits the selected object; arrow keys nudge it; Escape cancels.",
      "Chaque outil a un raccourci, et Ctrl/Cmd K ouvre la palette de commandes. Objets du tableau énumère chaque objet pour le sélectionner et le modifier sans souris. Tab passe d’une commande à l’autre; Entrée modifie l’objet sélectionné; les flèches le déplacent; Échap annule.",
    ],
  },
  {
    role: "participant",
    title: [
      "Join a board and collaborate live",
      "Se joindre à un tableau et collaborer en direct",
    ],
    body: [
      "Open the invitation link and sign in with Puter. You see other people's cursors, selections, and edits as they happen. Your role decides what you can do: editors change content, commenters add comments, reactions, and votes, and viewers follow along.",
      "Ouvrez le lien d’invitation et connectez-vous avec Puter. Vous voyez les curseurs, les sélections et les modifications des autres en direct. Votre rôle détermine ce que vous pouvez faire : les éditeurs modifient le contenu, les commentateurs ajoutent des commentaires, des réactions et des votes, et les lecteurs suivent.",
    ],
  },
  {
    role: "participant",
    title: [
      "Comment, mention, and get notified",
      "Commenter, mentionner et être avisé",
    ],
    body: [
      "Choose Comment (C) and click an object or empty space. Reply in the thread, resolve it when done, and type @ followed by a name to mention someone. Mentions and replies appear under Notifications in the library and, if you verified your email, by email.",
      "Choisissez Commentaire (C) et cliquez sur un objet ou un espace vide. Répondez dans le fil, résolvez-le une fois terminé et tapez @ suivi d’un nom pour mentionner quelqu’un. Les mentions et les réponses apparaissent sous Notifications dans la bibliothèque et, si vous avez vérifié votre courriel, par courriel.",
    ],
  },
  {
    role: "participant",
    title: [
      "Work offline or on a weak connection",
      "Travailler hors ligne ou avec une connexion faible",
    ],
    body: [
      "Your changes are kept on this device first and sent when the connection returns. The status beside the board name tells you when changes are waiting, live, or saved. Do not clear browser storage while changes are waiting.",
      "Vos modifications sont d’abord conservées sur cet appareil et envoyées au retour de la connexion. L’état à côté du nom du tableau indique si des modifications sont en attente, en direct ou enregistrées. Ne videz pas le stockage du navigateur pendant que des modifications sont en attente.",
    ],
  },
  {
    role: "participant",
    title: ["Recover earlier work", "Récupérer un travail antérieur"],
    body: [
      "Open More tools, then Version history. Restore a whole version, open it as a copy, restore selected objects or one frame, or recover objects deleted since. Restoring saves a new version, so nothing is lost.",
      "Ouvrez Plus d’outils, puis Historique des versions. Restaurez une version entière, ouvrez-en une copie, restaurez les objets sélectionnés ou un cadre, ou récupérez les objets supprimés depuis. La restauration enregistre une nouvelle version; rien n’est perdu.",
    ],
  },
  {
    role: "facilitator",
    title: ["Prepare a workshop", "Préparer un atelier"],
    body: [
      "Start from a facilitation playbook or template. Each step is a frame in order, so Frames and navigation and presentation mode walk through the agenda. Lock the frames and instructions you do not want moved, and add a timer.",
      "Commencez à partir d’un guide ou d’un modèle d’animation. Chaque étape est un cadre ordonné; Cadres et navigation et le mode présentation suivent donc l’ordre du jour. Verrouillez les cadres et les consignes à ne pas déplacer, et ajoutez une minuterie.",
    ],
  },
  {
    role: "facilitator",
    title: [
      "Guide attention during a session",
      "Diriger l’attention pendant une séance",
    ],
    body: [
      "From Participants, bring one person or everyone to your view, or follow someone. Presentation mode shows selected frames without exposing the rest of the board. The shared timer keeps everyone on time.",
      "À partir de Participants, amenez une personne ou tout le monde à votre vue, ou suivez quelqu’un. Le mode présentation montre les cadres choisis sans révéler le reste du tableau. La minuterie partagée garde tout le monde dans les temps.",
    ],
  },
  {
    role: "facilitator",
    title: ["Invite people with the right role", "Inviter avec le bon rôle"],
    body: [
      "Share board creates invitations as facilitator, editor, commenter, or viewer. Guests from outside your organization are marked in the participant list, and their access can expire. Link opens can point to one section. Board settings let you open the board to your organization or to anyone with the link, when your organization allows it.",
      "Partager le tableau crée des invitations comme animateur, éditeur, commentateur ou lecteur. Les invités de l’extérieur de l’organisation sont signalés dans la liste des participants et leur accès peut expirer. Le lien peut pointer vers une seule section. Les paramètres du tableau permettent de l’ouvrir à l’organisation ou à toute personne ayant le lien, lorsque votre organisation l’autorise.",
    ],
  },
  {
    role: "facilitator",
    title: ["Capture and share results", "Consigner et partager les résultats"],
    body: [
      "Group sticky notes by color, tag, or AI themes. Export frames as PDF, PowerPoint slides, images, SVG, or spreadsheets. PDF exports of large boards split across pages with an overview of the page grid.",
      "Regroupez les notes adhésives par couleur, étiquette ou thème proposé par l’IA. Exportez des cadres en PDF, en diapositives PowerPoint, en images, en SVG ou en feuilles de calcul. Les exportations PDF des grands tableaux se répartissent sur plusieurs pages, avec une vue d’ensemble de la grille de pages.",
    ],
  },
  {
    role: "admin",
    title: ["Set up your organization", "Configurer votre organisation"],
    body: [
      "Choose Set up an organization in the library. Your Puter account becomes the account owner. In Organization settings, add your email domains and turn on domain capture so colleagues who verify a work email join automatically, or send invitation links.",
      "Choisissez Créer une organisation dans la bibliothèque. Votre compte Puter devient le compte titulaire. Dans les paramètres de l’organisation, ajoutez vos domaines de courriel et activez la capture de domaine pour que les collègues qui vérifient un courriel professionnel se joignent automatiquement, ou envoyez des liens d’invitation.",
    ],
  },
  {
    role: "admin",
    title: [
      "Provision people from Google Workspace",
      "Provisionner des personnes depuis Google Workspace",
    ],
    body: [
      "Create an API key with the scim scope on the Security tab and give the SCIM base URL to your identity provider or automation. Provisioned people appear as pending until they sign in and verify that email; deactivating them ends their sessions everywhere. The REST API reference lists every endpoint.",
      "Créez une clé d’API avec la portée scim dans l’onglet Sécurité et fournissez l’URL de base SCIM à votre fournisseur d’identité ou à votre automatisation. Les personnes provisionnées sont en attente jusqu’à leur connexion et à la vérification de ce courriel; leur désactivation met fin à leurs séances partout. La référence de l’API REST énumère chaque point de terminaison.",
    ],
  },
  {
    role: "admin",
    title: [
      "Send audit logs to Microsoft Sentinel",
      "Envoyer les journaux d’audit à Microsoft Sentinel",
    ],
    body: [
      "Create a data collection endpoint and rule with a custom table in Azure Monitor, register an application with the Monitoring Metrics Publisher role on the rule, then enter the tenant, application, secret, endpoint, rule ID, and stream on the Security tab. Send a test event to confirm delivery. Alerts for public sharing, guest access, and permission changes can go to email and Slack.",
      "Créez un point de terminaison et une règle de collecte de données avec une table personnalisée dans Azure Monitor, inscrivez une application ayant le rôle Monitoring Metrics Publisher sur la règle, puis entrez le locataire, l’application, le secret, le point de terminaison, l’ID de la règle et le flux dans l’onglet Sécurité. Envoyez un événement d’essai pour confirmer la livraison. Les alertes de partage public, d’accès des invités et de changement d’autorisations peuvent être envoyées par courriel et dans Slack.",
    ],
  },
  {
    role: "admin",
    title: [
      "Govern sharing, AI, and retention",
      "Encadrer le partage, l’IA et la conservation",
    ],
    body: [
      "Policies control sharing outside the organization, guest access and expiry, public links, which AI features are available, how long audit logs and deleted boards are kept, and an organization-wide legal hold. The worker enforces every policy, not only the interface.",
      "Les politiques contrôlent le partage à l’extérieur de l’organisation, l’accès des invités et son expiration, les liens publics, les fonctions d’IA offertes, la durée de conservation des journaux d’audit et des tableaux supprimés, ainsi qu’une conservation légale pour toute l’organisation. Le serveur applique chaque politique, pas seulement l’interface.",
    ],
  },
  {
    role: "admin",
    title: ["Monitor adoption", "Suivre l’adoption"],
    body: [
      "The Overview tab reports active and inactive people, daily use, boards created, stale and duplicate boards, external sharing, and the largest sessions. Export reports as CSV or JSON, or schedule them by email.",
      "L’onglet Vue d’ensemble présente les personnes actives et inactives, l’utilisation quotidienne, les tableaux créés, les tableaux inactifs et en double, le partage externe et les plus grandes séances. Exportez les rapports en CSV ou en JSON, ou programmez leur envoi par courriel.",
    ],
  },
  {
    role: "admin",
    title: ["Migrate from Miro", "Migrer depuis Miro"],
    body: [
      "On the Boards tab, choose Migrate from Miro. Load your Miro boards with an access token, review a dry run, and migrate in phases. Owners and member roles carry over by email, a report lists every board's result, and a phase can be rolled back.",
      "Dans l’onglet Tableaux, choisissez Migrer depuis Miro. Chargez vos tableaux Miro avec un jeton d’accès, examinez un essai et migrez par étapes. Les propriétaires et les rôles des membres sont conservés par courriel, un rapport indique le résultat de chaque tableau et une étape peut être annulée.",
    ],
  },
  {
    role: "start",
    title: ["Accessibility features", "Fonctions d’accessibilité"],
    body: [
      "The interface works with a keyboard and screen readers, supports light, dark, and high-contrast system themes, respects reduced motion, and is available in English and French. Board objects gives a text list of the canvas, Find on board reads object text, and frames give large boards a navigable structure.",
      "L’interface fonctionne avec un clavier et des lecteurs d’écran, prend en charge les thèmes clair, sombre et à contraste élevé du système, respecte la réduction des animations et est offerte en français et en anglais. Objets du tableau donne une liste textuelle du canevas, Rechercher sur le tableau lit le texte des objets et les cadres donnent une structure navigable aux grands tableaux.",
    ],
  },
];
const ROLES = [
  ["all", "All guides"],
  ["start", "Getting started"],
  ["participant", "Participants"],
  ["facilitator", "Facilitators"],
  ["admin", "Administrators"],
];
// Case, accents, and the kind of apostrophe typed do not matter.
const fold = (text) =>
  text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'");
export function searchGuides(query = "", role = "all", lang = language) {
  const l = lang === "fr" ? 1 : 0;
  const words = fold(query).split(/\s+/).filter(Boolean);
  return GUIDES.filter((g) => role === "all" || g.role === role)
    .filter((g) => {
      const hay = fold([...g.title, ...g.body].join(" "));
      return words.every((w) => hay.includes(w));
    })
    .map((g) => ({ role: g.role, title: g.title[l], body: g.body[l] }));
}
export function createHelpCenter({
  modal,
  icon,
  tour,
  shortcuts,
  refresh = () => {},
  org = null,
  toast = () => {},
}) {
  return {
    open(role = "all") {
      modal(
        "Help and training",
        `<div class="help-top"><label class="search">${icon("search")}<input id="help-search" type="search" aria-label="${t("Search help")}" placeholder="${t("Search help")}"></label><label class="field">${t("Guides for")}<select id="help-role">${ROLES.map(([v, l]) => `<option value="${v}" ${v === role ? "selected" : ""}>${t(l)}</option>`).join("")}</select></label></div><div class="dialog-footer help-actions"><button class="secondary" id="help-tour">${icon("map")}${t("Take the tour")}</button><button class="secondary" id="help-keys">${icon("keyboard")}${t("Keyboard shortcuts")}</button></div><p id="help-count" class="sr-only" role="status"></p><div id="help-results" class="help-results"></div>${org?.info?.role ? `<form id="help-feedback" class="policy-form"><fieldset><legend>${t("Rate your experience")}</legend><div class="rating" role="radiogroup" aria-label="${t("How easy is Whiteboard to use?")}">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="help-ease" value="${n}" required> ${n}</label>`).join("")}</div><small>${t("1 is very hard, 5 is very easy. Ratings are anonymous.")}</small><div class="field"><span id="help-comment-label">${t("What would make it better? (optional)")}</span><div id="help-comment"></div></div><div class="dialog-footer"><button class="primary">${t("Send feedback")}</button></div></fieldset></form>` : ""}`,
        (d) => {
          d.classList.add("help-dialog");
          const placeholder = d.querySelector("#help-comment");
          const comment =
            placeholder &&
            createAuthoredField(
              placeholder,
              { text: "", lang: language },
              { maxLength: 1000 },
            );
          if (comment) {
            comment.style.minHeight = "3em";
            d.addEventListener("close", () => comment.destroy(), {
              once: true,
            });
          }
          const render = () => {
            const results = searchGuides(
              d.querySelector("#help-search").value,
              d.querySelector("#help-role").value,
            );
            d.querySelector("#help-results").innerHTML = results.length
              ? results
                  .map(
                    (g) =>
                      `<details class="help-guide"><summary>${escape(g.title)}</summary><p data-user-content>${escape(g.body)}</p></details>`,
                  )
                  .join("")
              : `<p>${t("No guides match your search.")}</p>`;
            // The count is announced, not every guide in the list.
            d.querySelector("#help-count").textContent = results.length
              ? `${results.length} ${t(results.length === 1 ? "guide" : "guides")}`
              : t("No guides match your search.");
            refresh();
          };
          d.querySelector("#help-search").oninput = render;
          d.querySelector("#help-role").onchange = render;
          d.querySelector("#help-tour").onclick = () => {
            d.close();
            tour();
          };
          d.querySelector("#help-keys").onclick = () => {
            d.close();
            shortcuts();
          };
          d.querySelector("#help-feedback")?.addEventListener(
            "submit",
            async (e) => {
              e.preventDefault();
              // A second press while sending would store the rating twice.
              if (e.target.dataset.busy) return;
              e.target.dataset.busy = "true";
              try {
                const content = trimmedFieldContent(comment);
                await org.request("feedback.submit", {
                  ease: Number(
                    d.querySelector('[name="help-ease"]:checked')?.value,
                  ),
                  comment: content.text,
                  ...(content.text && content.lang
                    ? { lang: content.lang }
                    : {}),
                  ...(content.textRuns?.length
                    ? { textRuns: content.textRuns }
                    : {}),
                  context: "help",
                });
                // The form gives way to a thank-you that keeps focus.
                const thanks = document.createElement("p");
                thanks.className = "dialog-copy";
                thanks.tabIndex = -1;
                thanks.textContent = t("Thank you for your feedback.");
                comment.destroy();
                e.target.replaceWith(thanks);
                thanks.focus();
                toast("Thank you for your feedback.");
              } catch (error) {
                toast(error.message);
              } finally {
                delete e.target.dataset.busy;
              }
            },
          );
          render();
        },
      );
    },
  };
}

addTranslations({
  "Help and training": "Aide et formation",
  "Rate your experience": "Évaluez votre expérience",
  "How easy is Whiteboard to use?": "Whiteboard est-il facile à utiliser?",
  "1 is very hard, 5 is very easy. Ratings are anonymous.":
    "1 signifie très difficile, 5 très facile. Les évaluations sont anonymes.",
  "What would make it better? (optional)":
    "Qu’est-ce qui l’améliorerait? (facultatif)",
  "Send feedback": "Envoyer la rétroaction",
  "Invalid feedback language.": "Langue de rétroaction invalide.",
  "Thank you for your feedback.": "Merci de votre rétroaction.",
  "Search help": "Chercher dans l’aide",
  guide: "guide",
  guides: "guides",
  "Guides for": "Guides pour",
  "All guides": "Tous les guides",
  "Getting started": "Premiers pas",
  Participants: "Participants",
  Facilitators: "Animateurs",
  Administrators: "Administrateurs",
  "Take the tour": "Faire la visite",
  "Keyboard shortcuts": "Raccourcis clavier",
  "No guides match your search.":
    "Aucun guide ne correspond à votre recherche.",
});
