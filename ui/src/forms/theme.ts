import { BaseInputTemplate } from './templates/BaseInputTemplate'
import { FieldTemplate } from './templates/FieldTemplate'
import { ObjectFieldTemplate } from './templates/ObjectFieldTemplate'
import { TitleFieldTemplate } from './templates/TitleFieldTemplate'
import { DescriptionFieldTemplate } from './templates/DescriptionFieldTemplate'
import { ErrorListTemplate } from './templates/ErrorListTemplate'
import { TextareaWidget } from './widgets/TextareaWidget'
import { CheckboxWidget } from './widgets/CheckboxWidget'
import { SelectWidget } from './widgets/SelectWidget'
import { TagsWidget } from './widgets/TagsWidget'
import { MediaWidget } from './widgets/MediaWidget'
import { JsonField } from './fields/JsonField'

export const slateTemplates = {
  BaseInputTemplate,
  FieldTemplate,
  ObjectFieldTemplate,
  TitleFieldTemplate,
  DescriptionFieldTemplate,
  ErrorListTemplate,
}

export const slateWidgets = {
  TextareaWidget,
  CheckboxWidget,
  SelectWidget,
  tags: TagsWidget,
  media: MediaWidget,
}

export const slateFields = {
  json: JsonField,
}
