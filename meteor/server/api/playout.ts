import { Meteor } from 'meteor/meteor'
import { RunningOrder, RunningOrders } from '../../lib/collections/RunningOrders'
import { ShowStyle, ShowStyles } from '../../lib/collections/ShowStyles'
import { SegmentLine, SegmentLines } from '../../lib/collections/SegmentLines'
import { SegmentLineItem, SegmentLineItems, ITimelineTrigger } from '../../lib/collections/SegmentLineItems'
import { StudioInstallation, StudioInstallations } from '../../lib/collections/StudioInstallations'
import { getCurrentTime, saveIntoDb, literal, DBObj, partialExceptId, Time, partial } from '../../lib/lib'
import { RundownAPI } from '../../lib/api/rundown'
import { TimelineTransition, Timeline, TimelineObj, TimelineContentType } from '../../lib/collections/Timeline'
import { TimelineObject, ObjectId, TriggerType, TimelineKeyframe } from 'superfly-timeline'
import { Transition, Ease, Direction } from '../../lib/constants/casparcg'
import { Segment, Segments } from '../../lib/collections/Segments'
import { Random } from 'meteor/random'
import * as _ from 'underscore'
import { logger } from './../logging'

Meteor.methods({
	/**
	 * Activates the RunningOrder:
	 * TODO: Set up the Timeline
	 * Set first item on Next queue
	 */
	'playout_activate': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, 'RunningOrder "' + roId + '" not found!')

		let anyOtherActiveRunningOrders = RunningOrders.find({
			studioInstallationId: runningOrder.studioInstallationId,
			active: true
		}).fetch()

		if (anyOtherActiveRunningOrders.length) {
			throw new Meteor.Error(400, 'Only one running-order can be active at the same time. Active runningOrders: ' + _.pluck(anyOtherActiveRunningOrders,'_id'))
		}
		let segmentLines = runningOrder.getSegmentLines()

		RunningOrders.update(runningOrder._id, {$set: {
			active: true,
			currentSegmentLineId: null,
			nextSegmentLineId: segmentLines[0]._id // put the first on queue
		}})
	},
	/**
	 * Inactivates the RunningOrder
	 * TODO: Clear the Timeline (?)
	 */
	'playout_inactivate': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, 'RunningOrder "' + roId + '" not found!')

		RunningOrders.update(runningOrder._id, {$set: {
			active: false,
			currentSegmentLineId: null,
			nextSegmentLineId: null
		}})
	},
	/**
	 * Perform the TAKE action, i.e start playing a segmentLineItem
	 */
	'playout_take': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, 'RunningOrder "' + roId + '" not found!')
		if (!runningOrder.nextSegmentLineId) throw new Meteor.Error(500, 'nextSegmentLineId is not set!')

		let takeSegmentLine = SegmentLines.findOne(runningOrder.nextSegmentLineId)
		if (!takeSegmentLine) throw new Meteor.Error(404, 'takeSegmentLine not found!')
		let takeSegment = Segments.findOne(takeSegmentLine.segmentId)

		let segmentLinesAfter = runningOrder.getSegmentLines({
			_rank: {
				$gt: takeSegmentLine._rank,
			},
			_id: {$ne: takeSegmentLine._id}
		})

		let nextSegmentLine: SegmentLine | null = segmentLinesAfter[0] || null

		RunningOrders.update(runningOrder._id, {$set: {
			currentSegmentLineId: takeSegmentLine._id,
			nextSegmentLineId: nextSegmentLine._id
		}})

		updateTimeline(runningOrder.studioInstallationId)
	},

	'playout_setNext': (roId: string, nextSlId: string) => {

		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, 'RunningOrder "' + roId + '" not found!')

		RunningOrders.update(runningOrder._id, {$set: {
			nextSegmentLineId: nextSlId
		}})

		// remove old auto-next from timeline, and add new one
		updateTimeline(runningOrder.studioInstallationId)
	}
})

function createSegmentLineGroup (segmentLine: SegmentLine, duration: Time): TimelineObj {
	let slGrp = literal<TimelineObj>({
		_id: 'sl-group-' + segmentLine._id,
		siId: undefined,
		roId: undefined,
		deviceId: '',
		trigger: {
			type: TriggerType.TIME_ABSOLUTE,
			value: 'now'
		},
		duration: duration,
		LLayer: 'core',
		content: {
			type: TimelineContentType.GROUP
		},
		isGroup: true
	})

	return slGrp
}

function transformSegmentLineIntoTimeline (segmentLine: SegmentLine, segmentLineGroup?: TimelineObj): Array<TimelineObj> {
	let timelineObjs: Array<TimelineObj> = []
	let items = segmentLine.getSegmentLinesItems()

	_.each(items, (item: SegmentLineItem) => {
		if (
			item.content &&
			item.content.timelineObjects
		) {
			let tos = item.content.timelineObjects

			_.each(tos, (o: TimelineObj) => {
				if (segmentLineGroup) {
					o.inGroup = segmentLineGroup._id
				}

				timelineObjs.push(o)
			})
		}
	})
	return timelineObjs
}

function updateTimeline (studioInstallationId: string) {
	const activeRunningOrder = RunningOrders.findOne({
		studioInstallationId: studioInstallationId,
		active: true
	})

	if (activeRunningOrder) {
		// remove anything not related to active running order:
		Timeline.remove({
			siId: studioInstallationId,
			roId: {
				$not: {
					$eq: activeRunningOrder._id
				}
			}
		})
		// Todo: Add default objects:
		let timelineObjs: Array<TimelineObj> = []

		// Generate timeline: -------------------------------------------------

		// Default timelineobjects

		// Currently playing

		let currentSegmentLine: SegmentLine | undefined
		let nextSegmentLine: SegmentLine | undefined
		let currentSegmentLineGroup: TimelineObj | undefined

		// we get the nextSegmentLine first, because that affects how the currentSegmentLine will be treated
		if (activeRunningOrder.nextSegmentLineId) {
			// We may be at the beginning of a show, and there can be no currentSegmentLine and we are waiting for the user to Take
			nextSegmentLine = SegmentLines.findOne(activeRunningOrder.nextSegmentLineId)
			if (!nextSegmentLine) throw new Meteor.Error(404, 'SegmentLine "' + activeRunningOrder.nextSegmentLineId + '" not found!')
		}

		if (activeRunningOrder.currentSegmentLineId) {
			currentSegmentLine = SegmentLines.findOne(activeRunningOrder.currentSegmentLineId)
			if (!currentSegmentLine) throw new Meteor.Error(404, 'SegmentLine "' + activeRunningOrder.currentSegmentLineId + '" not found!')

			// fetch items
			// fetch the timelineobjs in items
			const isFollowed = nextSegmentLine && nextSegmentLine.autoNext
			currentSegmentLineGroup = createSegmentLineGroup(currentSegmentLine, isFollowed ? currentSegmentLine.expectedDuration : Number.POSITIVE_INFINITY)
			timelineObjs = timelineObjs.concat(currentSegmentLineGroup, transformSegmentLineIntoTimeline(currentSegmentLine, currentSegmentLineGroup))
		}

		// only add the next objects into the timeline if the next segment is autoNext
		if (nextSegmentLine && nextSegmentLine.autoNext) {
			let nextSegmentLineGroup = createSegmentLineGroup(nextSegmentLine, Number.POSITIVE_INFINITY)
			if (currentSegmentLineGroup) {
				nextSegmentLineGroup.trigger = literal<ITimelineTrigger>({
					type: TriggerType.TIME_RELATIVE,
					value: '#' + currentSegmentLineGroup._id + '.end'
				})
			}
			timelineObjs = timelineObjs.concat(nextSegmentLineGroup, transformSegmentLineIntoTimeline(nextSegmentLine, nextSegmentLineGroup))
		}

		if (!activeRunningOrder.nextSegmentLineId && !activeRunningOrder.currentSegmentLineId) {
			// maybe at the end of the show
			logger.info('No next segmentLine and no current segment line set on running order "' + activeRunningOrder._id + '".')
		}

		// next (on pvw (or on pgm if first))

		// Pre-process the timelineObjects
		_.each(timelineObjs, (o) => {
			o.roId = activeRunningOrder._id
			o.siId = activeRunningOrder.studioInstallationId
		})

		console.log('timelineObjs', timelineObjs)

		saveIntoDb<TimelineObj, TimelineObj>(Timeline, {
			roId: activeRunningOrder._id
		}, timelineObjs, {
			beforeUpdate: (o: TimelineObj, oldO: TimelineObj): TimelineObj => {
				// do not overwrite trigger on the currentSegmentLine if it is already present
				if (currentSegmentLine && currentSegmentLine._id === oldO._id && o.trigger.value === 'now') {
					o = _.clone(o)
					o.trigger = oldO.trigger
				}
				return o
			}
		})
	} else {
		// remove everything:
		Timeline.remove({
			siId: studioInstallationId
		})
	}



}
