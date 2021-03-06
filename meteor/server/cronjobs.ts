import { RunningOrderDataCache } from '../lib/collections/RunningOrderDataCache'
import { RunningOrders } from '../lib/collections/RunningOrders'
import * as _ from 'underscore'
import { getCurrentTime } from '../lib/lib'

let lowPrioFcn = (fcn: (...args) => any, ...args: any[]) => {
	// Do it at a random time in the future:
	setTimeout(() => {
		fcn(...args)
	}, Math.random() * 10 * 1000)
}

Meteor.startup(() => {

	Meteor.setInterval(() => {
		let d = new Date(getCurrentTime())
		if (d.getHours() > 0 && d.getHours() < 5) { // Nighttime
			// remove old Running orders:
			RunningOrders.find({
				created: {$lt: getCurrentTime() - 60 * 24 * 3600 * 1000} // older than 60 days
			}).forEach(ro => {
				ro.remove()
			})

			// Clean up RunningOrder data cache:
			// Remove caches not related to running orders:
			let roIds = _.pluck(RunningOrders.find().fetch(), '_id')
			RunningOrderDataCache.find({
				roId: {$nin: roIds}
			}).forEach((roc) => {
				lowPrioFcn(RunningOrderDataCache.remove, roc._id)
			})
		}

	}, 3 * 3600 * 1000)

})
