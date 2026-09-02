import { createContext } from 'react'

// How many containers deep the fields being drawn sit: a labelled object group
// and an expanded array item each add one. Templates publish it to CSS as
// `--nest-depth`, which is what steps a card's surface and a group's rail one
// shade lighter per level. RJSF tells a template nothing about where in the
// tree it sits, so without this a component three levels down is drawn exactly
// like a top-level one.
export const NestingDepthContext = createContext(0)
