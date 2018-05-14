
import * as _ from 'underscore'

import {
	IMOSConnectionStatus,
	IMOSDevice,
	IMOSListMachInfo,
	MosString128,
	MosTime,
	IMOSRunningOrder,
	IMOSRunningOrderBase,
	IMOSRunningOrderStatus,
	IMOSStoryStatus,
	IMOSItemStatus,
	IMOSStoryAction,
	IMOSROStory,
	IMOSROAction,
	IMOSItemAction,
	IMOSItem,
	IMOSROReadyToAir,
	IMOSROFullStory,
	IMOSStory,
	IMOSExternalMetaData,
	IMOSROFullStoryBodyItem
} from 'mos-connection'
import { Segment, Segments } from '../../../lib/collections/Segments'
import { SegmentLine, SegmentLines } from '../../../lib/collections/SegmentLines'
import { SegmentLineItem, SegmentLineItems, ITimelineTrigger } from '../../../lib/collections/SegmentLineItems'
import { TriggerType } from 'superfly-timeline'
import { RundownAPI } from '../../../lib/api/rundown'
import { IOutputLayer,
	ISourceLayer
} from '../../../lib/collections/StudioInstallations'
import {
	TemplateFunction,
	TemplateSet,
	SegmentLineItemOptional,
	TemplateFunctionOptional,
	TemplateResult,
	TemplateContextInner,
	StoryWithContext
} from './templates'
import { TimelineContentType, TimelineObjCCGVideo, TimelineObjLawoSource, TimelineObjCCGTemplate, TimelineObjHTMLPost } from '../../../lib/collections/Timeline';

const literal = <T>(o: T) => o


// -------------------------------
// The template set:
let nrk: TemplateSet = {
	/**
	 * Returns the id of the template-function to be run
	 * @param story
	 */
	getId: literal<TemplateFunctionOptional>(function (context, story): string {
		let templateId = ''

		if (story.MosExternalMetaData) {
			_.find(story.MosExternalMetaData, (md) => {
				if (
					md.MosScope === 'PLAYLIST' &&
					md.MosSchema.match(/10505\/schema\/enps.dtd/)
				) {
					let type = md.MosPayload.mosartType + ''
					let variant = md.MosPayload.mosartVariant + ''

					if (type.match(/break/i)) 			templateId = 'break'
					// else if (type.match(/full/i) &&
					// 		!variant)			 		templateId = 'full'
					else if (type.match(/full/i) &&
							variant.match(/vignett/i)) 	templateId = 'vignett'
					else if (type.match(/stk/i) &&
							variant.match(/head/i)) 	templateId = 'stkHead'
				}
				if (templateId) return true // break
				else return false // keep looking
			})
		}
		console.log('getId', templateId)
		return templateId
	}),
	templates: {

		/**
		 * BREAK
		 */
		break: literal<TemplateFunctionOptional>((context, story): TemplateResult => {
			return {
				segmentLine: literal<SegmentLine>({
					_id: '',
					_rank: 0,
					mosId: '',
					segmentId: '',
					runningOrderId: '',
					slug: 'BREAK',
				}),
				segmentLineItems: [
					literal<SegmentLineItem>({
						_id: '',
						mosId: '',
						segmentLineId: '',
						runningOrderId: '',
						name: 'BREAK',
						trigger: {
							type: TriggerType.TIME_ABSOLUTE,
							value: 'now'
						},
						status: RundownAPI.LineItemStatusCode.OK,
						sourceLayerId: 'studio0_vignett',
						outputLayerId: 'pgm0',
						expectedDuration: 0
					})
				]
			}
		}),

		/**
		 * VIGNETT
		 */
		vignett: literal<TemplateFunctionOptional>(function (context, story) {
			let clip: string = ''
			let sourceDuration: number = 0
			let segmentLineduration: number = 0
			let mosId = ''

			// selects correct vignett clip file and sets the assosciated hard coded durations to match
			let mosartVariant = story.getValueByPath('MosExternalMetaData.0.MosPayload.mosartVariant', 'VIGNETT')
			switch (mosartVariant) {
				case 'VIGNETT2018':
					clip = 'vignett.mp4'	// @todo TBD
					sourceDuration = 40		// @todo TBD
					segmentLineduration = 5	// @todo TBD
					mosId = 'VIGNETT2018'
					break
			}

			let segmentLineItems: Array<SegmentLineItemOptional> = []
			let IDs = {
				lawo: context.getRandomId(),
				vignett: context.getRandomId()
			}

			let video: SegmentLineItemOptional = {
				_id: context.getRandomId(),
				mosId: mosId,
				name: clip,
				trigger: {
					type: TriggerType.TIME_ABSOLUTE,
					value: 'now'
				},
				status: RundownAPI.LineItemStatusCode.UNKNOWN,
				sourceLayerId: 'studio0_vignett',
				outputLayerId: 'pgm0',
				expectedDuration: segmentLineduration,
				content: {
					fileName: clip,
					sourceDuration: sourceDuration,
					timelineObjects: [
						literal<TimelineObjLawoSource>({
							_id: IDs.lawo, deviceId: '',
							trigger: { type: TriggerType.TIME_ABSOLUTE, value: 'now' },
							priority: -1,
							duration: 0,
							LLayer: 'lawo_source_effect',
							content: {
								type: TimelineContentType.LAWO_AUDIO_SOURCE,
								attributes: {
									db: 0
								}
							}
						}),
						literal<TimelineObjCCGVideo>({
							_id: IDs.vignett, deviceId: '',
							trigger: { type: TriggerType.TIME_RELATIVE, value: `#${IDs.lawo}.start + 0` },
							priority: -1,
							duration: sourceDuration,
							LLayer: 'casparcg_player_vignett',
							content: {
								type: TimelineContentType.VIDEO,
								attributes: {
									file: clip
								}
							}
						})
					]
				}
			}

			segmentLineItems.push(video)

			return literal<TemplateResult>({
				segmentLine: null,
				segmentLineItems: segmentLineItems
			})
		}),

		/**
		 * STK HEAD
		 */
		stkHead: literal<TemplateFunctionOptional>(function (context, story) {
			let IDs = {
				lawo_automix: context.getRandomId(),
				headVideo: context.getRandomId(),
				headGfx: context.getRandomId()
			}

			let isFirstHeadAfterVignett = false // @todo @johan

			let storyItemClip = _.find(story.Body, (item) => {
				return (
					item.Type === 'storyItem' &&
					context.getValueByPath(item, 'Content.mosExternalMetadata.0.mosPayload.objectType')
						=== 'CLIP'
				)
			})
			if (!storyItemClip) context.warning('Clip missing in mos data')
			let storyItemGfx = _.find(story.Body, (item) => {
				return (
					item.Type === 'storyItem' &&
					context.getValueByPath(item, 'Content.mosExternalMetadata.0.mosPayload.subtype')
						=== 'lyric/data'
					// context.getValueByPath(item, 'Content.mosID') // for kompatibilitet med ny grafikk
					// === 'GFX.NRK.MOS'
				)
			})
			if (!storyItemGfx) context.warning('Super missing in mos data')

			let clip = context.getValueByPath(storyItemClip, 'Content.myclipNameSomething')	// @todo Missing data in mos
			let mosId = context.getValueByPath(storyItemClip, 'Content.objID', 'Head')

			let segmentLineItems: Array<SegmentLineItemOptional> = []
			let video: SegmentLineItemOptional = {
				_id: context.getRandomId(),
				mosId: mosId,
				name: clip,
				trigger: {
					type: TriggerType.TIME_ABSOLUTE,
					value: 'now'
				},
				status: RundownAPI.LineItemStatusCode.UNKNOWN,
				sourceLayerId: 'studio0_live_speak0',
				outputLayerId: 'pgm0',
				expectedDuration: (
					story.getValueByPath('MosExternalMetaData.0.MosPayload.Estimated') ||
					context.sumMosItemDurations(story.getValueByPath('MosExternalMetaData.0.MosPayload.MOSItemDurations')) ||
					story.getValueByPath('MosExternalMetaData.0.MosPayload.MediaTime') ||
					story.getValueByPath('MosExternalMetaData.0.MosPayload.SourceMediaTime') ||
					10
				),
				content: {
					fileName: clip,
					sourceDuration: (
						context.getValueByPath(storyItemClip, 'Content.objDur', 0) /
						(context.getValueByPath(storyItemClip, 'Content.objTB') || 1)
					),
					timelineObjects: [
						literal<TimelineObjLawoSource>({
							_id: IDs.lawo_automix, deviceId: '',
							trigger: { type: TriggerType.TIME_ABSOLUTE, value: 'now' },
							priority: -1,
							duration: 0,
							LLayer: 'lawo_source_automix',
							content: {
								type: TimelineContentType.LAWO_AUDIO_SOURCE,
								transitions: {
									inTransition: {
										type: 'MIX',
										duration: 200
									}
								},
								attributes: {
									db: 0
								}
							}
						}),
						literal<TimelineObjCCGVideo>({
							_id: IDs.headVideo, deviceId: '',
							trigger: { type: TriggerType.TIME_RELATIVE, value: `#${IDs.lawo_automix}.start + 0` },
							priority: -1,
							duration: (
								context.getValueByPath(storyItemClip, 'Content.objDur', 0) /
								(context.getValueByPath(storyItemClip, 'Content.objTB') || 1)
							),
							LLayer: 'casparcg_player_vignett',
							content: {
								type: TimelineContentType.VIDEO,
								attributes: {
									file: clip
								}
							}
						})
					]
				}
			}
			segmentLineItems.push(video)

			let trigger: ITimelineTrigger = {
				type: TriggerType.TIME_ABSOLUTE,
				value: 0
			}
			let inTriggerType = context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.trigger','') + ''
			let outTriggerType = context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.out','')

			let mosInTime = (parseFloat(context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.in',0)) || 0) / 1000
			mosId = context.getValueByPath(storyItemGfx, 'Content.objID', 'Head')
			let name = context.getValueByPath(storyItemGfx, 'Content.abstract', 'Temasuper')
			let duration = 0
			
			if (inTriggerType.match(/auto/i)) {
				trigger = {
					type: TriggerType.TIME_RELATIVE,
					value: `#${video._id}.start + ${mosInTime}`
				}
			} else if (inTriggerType.match(/manual/i)) {
				// keep TIME.ABSOLUTE and 0 to prevent it from starting
			} else {
				context.warning('Unknown in-trigger: "' + inTriggerType + '"')
			}
			
			if (outTriggerType.match(/auto/i)) {
				duration = (
					(context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.duration', 0) || 0 ) / 
					(context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.timeBase') || 1)
				)
			} else if (outTriggerType.match(/onNext/i)) {
				// keep TIME.ABSOLUTE and 0 to prevent it from starting
			} else if (outTriggerType.match(/manual/i)) {
				// keep TIME.ABSOLUTE and 0 to prevent it from starting
			} else {
				context.warning('Unknown out-trigger: "' + outTriggerType + '"')
			}

			let gfx: SegmentLineItemOptional = {
				_id: context.getRandomId(),
				mosId: mosId,
				name: name,
				trigger: trigger,
				status: RundownAPI.LineItemStatusCode.UNKNOWN,
				sourceLayerId: 'studio0_graphics0',
				outputLayerId: 'pgm0',
				expectedDuration: duration,
				content: {
					fileName: clip,
					sourceDuration: duration,
					timelineObjects: [
						literal<TimelineObjHTMLPost>({
							_id: IDs.headGfx, deviceId: '',
							trigger: {
								type: TriggerType.TIME_ABSOLUTE,
								value: 'now'
							},
							priority: -1,
							duration: duration,
							LLayer: 'casparcg_cg_graphics',
							content: {
								type: TimelineContentType.NRK_TEMPLATE,
								attributes: {
									render: {
										channel: context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.render.channel', ''),
										system: 'html',
										group: 'DKKristiansand'
									},
									playout: {
										event: context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.playout.event', ''),
										layer: context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.playout.layer', ''),
										template: context.getValueByPath(storyItemGfx, 'Content.mosExternalMetadata.0.mosPayload.playout.template', '')
									}
								}
							}
						})
					]
				}
			}
			segmentLineItems.push(gfx)

			return literal<TemplateResult>({
				segmentLine: null,
				segmentLineItems: segmentLineItems
			})
		})
	}
}

export {nrk}