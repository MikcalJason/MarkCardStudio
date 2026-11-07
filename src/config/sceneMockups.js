// Scene mockup templates place an already-rendered card onto a screen, a sheet
// of paper, a notebook page, or a printed poster inside a lifestyle photo.
// `quad` is stored in the scene photo's own normalized coordinates (0-1, origin
// top-left) so re-encoding the scene at a different size never invalidates the
// calibration. `cornerRadius` is the surface corner radius as a fraction of the
// surface width, masked in card space so the corners stay round after the
// perspective warp. `fit` describes how the card meets that surface:
// - `fill`: the quad is the device's panel, so the 3:4 card is painted across it
//   exactly and the projective warp supplies the foreshortening. Portrait pads
//   use this; their plate is 3:4 hardware, and it leaves no margin at all.
// - `contain`: keeps the whole card and continues the card's own edge colours
//   across the margin. Used where the surface really is another physical shape
//   (landscape monitors, laptops, sheets of paper).
// - `cover`: fills the quad and crops, for flat prints already close to 3:4.
// Every quad must hug the blank screen or sheet in the photo: the compositor can
// only paint the calibrated area, so a loose quad leaves a ring of the photo's
// blank plate around the card. `imageVersion` exists because stored corner
// corrections are validated against the photo they were made for: bump it
// whenever a scene is re-generated at the same `image` path, and only then —
// corrections for that scene are dropped as stale offsets.
export const SCENE_MOCKUP_OUTPUT = { width: 1536, height: 2048 };

// A gallery scene page is a full-bleed scene photo, so the card inside it only
// gets the pixels its calibrated quad covers — often a third to half of the
// frame. Rendering that page at the platform canvas minifies the card and its
// type turns to mush, so the page canvas is derived from the quad instead: the
// frame is made wide enough for the card to keep its own pixel width, clamped
// so one scene can never ask for an absurd canvas. Export, scan-to-preview, and
// the gallery composite all read this helper, so they cannot drift apart.
export const SCENE_PAGE_MIN_LONG_SIDE = 2048;
export const SCENE_PAGE_MAX_LONG_SIDE = 2880;

function quadWidthFraction(quad) {
  if (!quad?.tl || !quad?.tr || !quad?.bl || !quad?.br) return 0;
  const span = (from, to) => Math.hypot(to[0] - from[0], to[1] - from[1]);
  const width = (span(quad.tl, quad.tr) + span(quad.bl, quad.br)) / 2;
  // A quad narrower than this is a calibration accident, not a surface.
  return width < 0.08 ? 0 : Math.min(1, width);
}

export function scenePageSize(width, height, quad = null, cardWidth = 0) {
  const platformWidth = Number(width) || 1080;
  const platformHeight = Number(height) || 1440;
  const platformLong = Math.max(platformWidth, platformHeight);
  const card = Number(cardWidth) || platformWidth;
  const fraction = quadWidthFraction(quad);

  // Quad x is normalized to the photo, and a 3:4 photo fills a 3:4 frame, so the
  // card's share of the frame is the quad's own width fraction.
  let frameWidth = fraction ? card / fraction : platformWidth;
  let frameHeight = frameWidth * (platformHeight / platformWidth);
  const frameLong = Math.max(frameWidth, frameHeight);
  const targetLong = Math.min(
    SCENE_PAGE_MAX_LONG_SIDE,
    Math.max(SCENE_PAGE_MIN_LONG_SIDE, frameLong),
  );
  const scale = frameLong > 0 ? targetLong / frameLong : 1;
  frameWidth *= scale;
  frameHeight *= scale;

  return {
    width: Math.max(2, Math.round(frameWidth)),
    height: Math.max(2, Math.round(frameHeight)),
  };
}

export const SCENE_CATEGORIES = [
  { id: "home", labelKey: "sceneMockup.categories.home" },
  { id: "study", labelKey: "sceneMockup.categories.study" },
  { id: "lifestyle", labelKey: "sceneMockup.categories.lifestyle" },
  { id: "travel", labelKey: "sceneMockup.categories.travel" },
  { id: "print", labelKey: "sceneMockup.categories.print" },
];

export const SCENE_MOCKUP_TEMPLATES = [
  // HD samples: 1536×1972 photos generated straight at the scene page size, so
  // the surface is sampled 1:1 instead of being upscaled from 768 px. The quads
  // are a starting calibration — the picker's corner handles refine them.
  {
    id: "studio-wall",
    category: "print",
    surface: "paper",
    fit: "cover",
    labelKey: "sceneMockup.templates.studioWall",
    image: "/mockups/studio-wall.jpg",
    quad: {
      tl: [0.2656, 0.2252],
      tr: [0.7660, 0.2190],
      br: [0.7500, 0.7789],
      bl: [0.2604, 0.7627],
    },
    cornerRadius: 0.002,
    lighting: null,
  },
  {
    id: "tablet-stand",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.tabletStand",
    image: "/mockups/tablet-stand.jpg",
    quad: {
      tl: [0.3047, 0.2135],
      tr: [0.6849, 0.2277],
      br: [0.6146, 0.6978],
      bl: [0.2318, 0.6790],
    },
    cornerRadius: 0.018,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 248, 235", opacity: 0.05 },
      dim: 0.01,
    },
  },
  {
    id: "desk",
    category: "study",
    surface: "screen",
    // A 16:10 pad panel, not the card's 3:4: `fill` would condense the type by
    // ~17%, so the card keeps its proportions and the margin continues its own
    // top and bottom rows across the rest of the screen.
    fit: "contain",
    labelKey: "sceneMockup.templates.desk",
    image: "/mockups/desk.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.2879, 0.3879],
      tr: [0.6213, 0.3748],
      br: [0.7254, 0.7686],
      bl: [0.3815, 0.7995],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 240, 220", opacity: 0.07 },
      dim: 0.01,
    },
  },
  {
    id: "library",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.library",
    image: "/mockups/library.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.3171, 0.3098],
      tr: [0.7699, 0.3061],
      br: [0.7366, 0.8631],
      bl: [0.2525, 0.8396],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 232, 200", opacity: 0.09 },
      dim: 0.02,
    },
  },
  {
    id: "classroom",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.classroom",
    image: "/mockups/classroom.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.3204, 0.3639],
      tr: [0.6924, 0.3654],
      br: [0.5773, 0.8507],
      bl: [0.2045, 0.8001],
    },
    cornerRadius: 0.035,
    lighting: {
      glare: 0.07,
      tint: { color: "236, 244, 255", opacity: 0.05 },
      dim: 0,
    },
  },

  // Home
  {
    id: "bedroom",
    category: "home",
    surface: "screen",
    // The plate in this photo is a phone screen: 442 x 1004 px, an aspect of
    // 0.44 against the card's 0.75. `fill` would squash the type sideways and
    // `cover` would cut ~40% of the card's width, so the card keeps its own
    // proportions and the margin continues its top and bottom rows.
    fit: "contain",
    labelKey: "sceneMockup.templates.bedroom",
    image: "/mockups/bedroom.jpg",
    imageVersion: 2,
    quad: {
      tl: [0.3583, 0.2662],
      tr: [0.6458, 0.2662],
      br: [0.6458, 0.7760],
      bl: [0.3583, 0.7760],
    },
    cornerRadius: 0.012,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 236, 210", opacity: 0.08 },
      dim: 0.01,
    },
  },

  // Everyday life and outdoors
  {
    id: "cafe",
    category: "lifestyle",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.cafe",
    image: "/mockups/cafe.jpg",
    imageVersion: 2,
    quad: {
      tl: [0.2458, 0.2013],
      tr: [0.8167, 0.2013],
      br: [0.8167, 0.7922],
      bl: [0.2458, 0.7922],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.08,
      tint: { color: "255, 198, 150", opacity: 0.12 },
      dim: 0.02,
    },
  },

  // On the road
  {
    id: "rail",
    category: "travel",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.rail",
    image: "/mockups/rail.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.3766, 0.3044],
      tr: [0.7497, 0.3018],
      br: [0.6931, 0.8202],
      bl: [0.3015, 0.7834],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.09,
      tint: { color: "240, 248, 255", opacity: 0.06 },
      dim: 0.01,
    },
  },

  // Printed paper, pages, and wall art
  {
    id: "poster-wall",
    category: "print",
    surface: "paper",
    // The sheet in this photo is far wider than 3:4, so cropping to fill it
    // would cut most of the card; the margin fill continues the paper instead.
    fit: "contain",
    labelKey: "sceneMockup.templates.posterWall",
    image: "/mockups/poster-wall.jpg",
    imageVersion: 2,
    quad: {
      tl: [0.2743, 0.2516],
      tr: [0.7272, 0.2509],
      br: [0.7230, 0.7328],
      bl: [0.2711, 0.7306],
    },
    cornerRadius: 0.003,
    lighting: null,
  },
  {
    id: "notebook",
    category: "print",
    surface: "paper",
    // The sheet is 0.80 against the card's 0.75, so filling it only costs a hair
    // over each side edge — a print should not float in a bordered margin.
    fit: "cover",
    labelKey: "sceneMockup.templates.notebook",
    image: "/mockups/notebook.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.1556, 0.2957],
      tr: [0.7789, 0.2093],
      br: [0.8859, 0.8896],
      bl: [0.1874, 0.9238],
    },
    cornerRadius: 0.004,
    lighting: null,
  },

  // Camping and outdoors (portrait tablet, blank screen centred, unobstructed).
  {
    id: "camping",
    category: "lifestyle",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.camping",
    image: "/mockups/camping.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.360, 0.428],
      tr: [0.650, 0.424],
      br: [0.656, 0.736],
      bl: [0.352, 0.732],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.06,
      tint: { color: "255, 232, 200", opacity: 0.08 },
      dim: 0.01,
    },
  },
  {
    id: "campsite",
    category: "lifestyle",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.campsite",
    image: "/mockups/campsite.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.348, 0.452],
      tr: [0.652, 0.452],
      br: [0.652, 0.812],
      bl: [0.348, 0.812],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 230, 198", opacity: 0.08 },
      dim: 0.01,
    },
  },

  // Study and office (landscape tablet / laptop, plate is wider than 3:4).
  {
    id: "office",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.office",
    image: "/mockups/office.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.245, 0.415],
      tr: [0.795, 0.405],
      br: [0.812, 0.720],
      bl: [0.205, 0.735],
    },
    cornerRadius: 0.035,
    lighting: {
      glare: 0.05,
      tint: { color: "236, 244, 255", opacity: 0.05 },
      dim: 0,
    },
  },
  {
    id: "workspace",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.workspace",
    image: "/mockups/workspace.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.262, 0.430],
      tr: [0.748, 0.418],
      br: [0.760, 0.700],
      bl: [0.250, 0.712],
    },
    cornerRadius: 0.035,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 240, 220", opacity: 0.06 },
      dim: 0.01,
    },
  },
  {
    id: "laptop",
    category: "study",
    surface: "laptop",
    fit: "contain",
    labelKey: "sceneMockup.templates.laptop",
    image: "/mockups/laptop.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.155, 0.325],
      tr: [0.855, 0.320],
      br: [0.860, 0.675],
      bl: [0.150, 0.680],
    },
    cornerRadius: 0.012,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 236, 210", opacity: 0.07 },
      dim: 0.01,
    },
  },

  // Lifestyle with a person seated behind the device; hands stay off the screen.
  {
    id: "cafe-person",
    category: "lifestyle",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.cafePerson",
    image: "/mockups/cafe-person.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.248, 0.300],
      tr: [0.730, 0.300],
      br: [0.735, 0.772],
      bl: [0.243, 0.772],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.06,
      tint: { color: "255, 224, 190", opacity: 0.08 },
      dim: 0.02,
    },
  },

  // Travel: portrait tablet on a beach blanket, sea and sky behind.
  {
    id: "beach",
    category: "travel",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.beach",
    image: "/mockups/beach.jpg",
    imageVersion: 1,
    quad: {
      tl: [0.228, 0.172],
      tr: [0.792, 0.168],
      br: [0.798, 0.782],
      bl: [0.222, 0.786],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.08,
      tint: { color: "240, 248, 255", opacity: 0.06 },
      dim: 0,
    },
  },
];

export const SCENE_QUAD_POINTS = ["tl", "tr", "br", "bl"];

export function findSceneTemplate(id) {
  return SCENE_MOCKUP_TEMPLATES.find((template) => template.id === id) || null;
}

export function normalizeSceneId(value) {
  return findSceneTemplate(value) ? value : "";
}
