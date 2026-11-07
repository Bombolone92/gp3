import { addTranslations } from "./i18n.js";
import { SHAPES, SHAPE_FAMILIES } from "./shapes.js";
// French labels for the specialist shape families and the content library.
// Kept locally too, so search matches both languages in either interface.
const FRENCH = {
  Rectangle: "Rectangle",
  Ellipse: "Ellipse",
  Diamond: "Losange",
  Triangle: "Triangle",
  Parallelogram: "Parallélogramme",
  Hexagon: "Hexagone",
  Star: "Étoile",
  Cylinder: "Cylindre",
  Terminator: "Terminaison",
  Process: "Processus",
  "Start or end": "Début ou fin",
  Decision: "Décision",
  "Input or output": "Entrée ou sortie",
  Database: "Base de données",
  Preparation: "Préparation",
  "Basic shape": "Forme simple",
  "Sticky note": "Note adhésive",
  Text: "Texte",
  Document: "Document",
  "Multiple documents": "Documents multiples",
  "Predefined process": "Processus prédéfini",
  "Manual input": "Saisie manuelle",
  "Manual operation": "Opération manuelle",
  Delay: "Délai",
  Display: "Affichage",
  "Off-page connector": "Renvoi de page",
  Or: "Ou",
  "Summing junction": "Jonction de sommation",
  "Internal storage": "Stockage interne",
  Merge: "Fusion",
  Cloud: "Nuage",
  Server: "Serveur",
  Queue: "File d’attente",
  "User or actor": "Utilisateur ou acteur",
  "Mobile device": "Appareil mobile",
  Laptop: "Ordinateur portable",
  "Browser window": "Fenêtre de navigateur",
  Firewall: "Pare-feu",
  "Load balancer": "Répartiteur de charge",
  API: "API",
  Container: "Conteneur",
  "Data store": "Dépôt de données",
  Touchpoint: "Point de contact",
  "Pain point": "Point de friction",
  "Positive emotion": "Émotion positive",
  "Neutral emotion": "Émotion neutre",
  "Negative emotion": "Émotion négative",
  "Lane header": "En-tête de couloir",
  "Start event": "Événement de début",
  "Intermediate event": "Événement intermédiaire",
  "End event": "Événement de fin",
  Task: "Tâche",
  Subprocess: "Sous-processus",
  "Exclusive gateway": "Passerelle exclusive",
  "Parallel gateway": "Passerelle parallèle",
  "Inclusive gateway": "Passerelle inclusive",
  "Data object": "Objet de données",
  Class: "Classe",
  Note: "Note",
  Package: "Paquetage",
  Button: "Bouton",
  "Text input": "Champ de texte",
  Checkbox: "Case à cocher",
  "Radio button": "Bouton radio",
  "Selected radio button": "Bouton radio sélectionné",
  Toggle: "Interrupteur",
  Dropdown: "Liste déroulante",
  "Search bar": "Barre de recherche",
  "Navigation bar": "Barre de navigation",
  "Tab bar": "Barre d’onglets",
  Card: "Carte",
  "Image placeholder": "Espace réservé pour une image",
  Avatar: "Avatar",
  "Modal dialog": "Boîte de dialogue modale",
  "Mobile phone frame": "Cadre de téléphone mobile",
  "Tablet frame": "Cadre de tablette",
  Slider: "Curseur",
  "Progress bar": "Barre de progression",
  Pagination: "Pagination",
  "Text placeholder": "Texte de remplacement",
  Flowchart: "Organigramme",
  Architecture: "Architecture",
  "Data flow": "Flux de données",
  "Service blueprint": "Plan de service",
  "Journey map": "Carte de parcours",
  BPMN: "BPMN",
  UML: "UML",
  Wireframe: "Maquette fonctionnelle",
  "Basic shapes": "Formes de base",
  "Architecture and data flow": "Architecture et flux de données",
  "Service blueprint and journey": "Plan de service et parcours",
  "Data (input or output)": "Données (entrée ou sortie)",
  Extract: "Extraction",
  Actor: "Acteur",
  "Text and notes": "Texte et notes",
  "Search shapes": "Rechercher des formes",
  "Shape families": "Familles de formes",
  "No shapes found.": "Aucune forme trouvée.",
  All: "Tout",
  Templates: "Modèles",
  Components: "Composants",
  "Icons and stickers": "Icônes et autocollants",
  "Library sections": "Sections de la bibliothèque",
  "Template categories": "Catégories de modèles",
  Playbooks: "Guides d’animation",
  Playbook: "Guide d’animation",
  "Search components": "Rechercher des composants",
  "Component groups": "Groupes de composants",
  "No components found.": "Aucun composant trouvé.",
  "Search icons": "Rechercher des icônes",
  "Icon categories": "Catégories d’icônes",
  "Icon color": "Couleur de l’icône",
  "No icons found.": "Aucune icône trouvée.",
  "Insert component": "Insérer le composant",
  "Insert icon": "Insérer l’icône",
  "Open a board to insert components and icons.":
    "Ouvrez un tableau pour insérer des composants et des icônes.",
  "Template library, components, and icons":
    "Bibliothèque de modèles, composants et icônes",
};
addTranslations(FRENCH);
// Search matching ignores case and accents, and treats typed and curly
// apostrophes and the œ and æ ligatures alike, as French text uses them.
export const fold = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLocaleLowerCase();
const names = new Map(SHAPES.map((s) => [s.key, s]));
// Library entries with display names; the same key can appear in several
// families under a domain name.
export function shapeFamilies(change = false) {
  const families = SHAPE_FAMILIES.map((family) => ({
    ...family,
    shapes: family.shapes.map(({ key, name }) => ({
      key,
      name: name || names.get(key).name,
      hint: names.get(key).hint,
    })),
  }));
  if (change)
    families.unshift({
      id: "text",
      name: "Text and notes",
      shapes: [
        { key: "note", name: "Sticky note" },
        { key: "text", name: "Text" },
      ],
    });
  return families;
}
// Matches every word in English or French names, hints and family names.
export function searchShapes(query = "", family = "", change = false) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return shapeFamilies(change)
    .filter((f) => !family || f.id === family)
    .map((f) => ({
      ...f,
      shapes: f.shapes.filter((s) => {
        const text = fold(
          [s.key, s.name, s.hint || "", f.name]
            .flatMap((v) => [v, translate(v)])
            .join(" "),
        );
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((f) => f.shapes.length);
}
const translate = (value) => FRENCH[value] || value;
// Inline SVG for an icon library entry, drawn like the interface icons.
export function iconSvg(node) {
  const body = node
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${String(v).replace(/"/g, "")}"`)
          .join(" ")}/>`,
    )
    .join("");
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
