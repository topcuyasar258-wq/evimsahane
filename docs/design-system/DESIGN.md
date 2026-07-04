---
name: High-Performance Realty
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002113'
  on-tertiary-container: '#009668'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 64px
  container-max: 1280px
  gutter: 20px
  margin-mobile: 16px
---

## Brand & Style
The design system is engineered for high-conversion real estate transactions, blending **Modern Professionalism** with **Functional Luxury**. The brand personality is authoritative yet accessible, positioning the service as an elite but transparent partner in the property search journey.

The visual style utilizes a refined **Minimalist** foundation with **Corporate Modern** accents. It prioritizes clarity and speed over decorative flair. Key characteristics include:
- **High Information Density:** Content-rich layouts that don't feel cluttered.
- **Conversion Utility:** Visual prominence is strictly reserved for actionable elements (CTAs, contact methods).
- **Trust-Centric:** A clean, structured aesthetic that mirrors the stability and reliability expected in high-value real estate.
- **Performance-First:** Implementation avoids heavy JS-driven animations, favoring CSS-based transitions and static clarity to ensure instant page loads.

## Colors
The palette is designed to instill confidence and drive immediate user action.

- **Primary (Deep Slate Blue):** Used for navigation, headers, and text to establish an authoritative and professional foundation.
- **Secondary (Vibrant Blue):** The primary action color. Used for standard CTAs like "View Details" or "Book Appointment."
- **Tertiary (Emerald Green):** Exclusively reserved for high-priority communication channels, specifically WhatsApp and "Call Now" buttons, leveraging the universal association of green with "Go" and connectivity.
- **Neutral (Slate Gray):** Used for secondary text, borders, and icons to maintain a clean hierarchy without competing for attention.
- **Backgrounds:** Pure white (#FFFFFF) for the main canvas to ensure maximum readability, with soft slate (#F8FAFC) for surface containers to differentiate content sections.

## Typography
This design system utilizes **Inter** exclusively for its exceptional readability at small sizes and its neutral, systematic appearance. 

- **Hierarchy:** Strong weight contrast is used to guide the eye. Headlines use `Bold (700)` or `SemiBold (600)` to anchor the page, while body text remains `Regular (400)` for optimal legibility during long-form property descriptions.
- **Performance:** Using a single variable font family reduces HTTP requests and ensures rapid rendering.
- **Scale:** On mobile devices, large headlines are aggressively scaled down to prevent excessive scrolling and ensure key listing information stays above the fold.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a focus on mobile ergonomics.

- **Rhythm:** A 4px base unit ensures consistent proportions.
- **Desktop:** A 12-column grid with a 1280px max-width container. 24px gutters provide breathing room for high-quality property photography.
- **Mobile:** A single-column layout with 16px side margins. Elements are sized for "thumb-friendly" interaction, ensuring all interactive targets are at least 48px in height.
- **Sticky Elements:** The design system mandates sticky bottom navigation or CTA bars on mobile to ensure the "WhatsApp" and "Contact" buttons are always accessible regardless of scroll depth.

## Elevation & Depth
Depth is used sparingly to maintain performance and a clean, modern aesthetic. 

- **Tonal Layers:** Elevation is primarily achieved through surface color changes. Property cards use a subtle 1px border (#E2E8F0) and a very light, diffused ambient shadow to lift them from the background.
- **Shadows:** When used, shadows are tinted with the primary color to avoid a "dirty" gray look. (e.g., `box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05)`).
- **Sticky Depth:** Sticky headers and mobile CTA bars use a 100% white background with a crisp bottom border or top shadow to indicate they sit above the scrolling content.

## Shapes
The design system uses a **Rounded** (0.5rem) shape language. 

- **Corners:** 8px (0.5rem) is the standard radius for cards, input fields, and buttons. This strikes a balance between the sharp, rigid look of traditional "corporate" finance and the overly soft, "bubbly" look of consumer social apps.
- **Images:** Property photography should follow the same 8px radius to maintain a unified visual language. 
- **Icons:** Use linear icons with slightly rounded caps to match the typography and corner radii.

## Components
- **Buttons:** 
  - *Primary:* Solid Vibrant Blue with white text for main actions. 
  - *Communication:* Solid Emerald Green with white text and a WhatsApp icon. 
  - *Secondary:* Ghost style (Blue border, transparent background) for "Save" or "Share."
  - *Sizing:* 48px minimum height for mobile accessibility.
- **Property Cards:** 
  - High-aspect-ratio images (4:3) using WebP. 
  - Clear price tag in the top left, status badge (e.g., "For Sale") in the top right. 
  - Condensed metadata (Beds, Baths, Sqft) using `label-md` for quick scanning.
- **Input Fields:** 
  - Clean, 1px bordered boxes. Labels always visible above the field (no floating labels for better accessibility). 
  - Focus state uses a 2px Vibrant Blue outline.
- **Sticky Mobile CTA:** 
  - A persistent bar at the bottom of the viewport on mobile property pages. 
  - Divided 50/50 between "Call" and "WhatsApp" for immediate lead generation.
- **Chips:** 
  - Used for property features (e.g., "Parking," "Pool"). 
  - Light gray backgrounds with `label-sm` text.