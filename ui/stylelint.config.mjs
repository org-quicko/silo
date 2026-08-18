export default {
  rules: {
    'at-rule-no-unknown': true,
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-properties': true,
    'declaration-block-no-shorthand-property-overrides': true,
    'font-family-no-duplicate-names': true,
    'function-no-unknown': true,
    'keyframe-block-no-duplicate-selectors': true,
    'no-duplicate-at-import-rules': true,
    'no-duplicate-selectors': true,
    'property-no-unknown': true,
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
    'selector-pseudo-element-no-unknown': true,
    'unit-no-unknown': true,
  },
}
