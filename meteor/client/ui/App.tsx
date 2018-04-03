import { Meteor } from 'meteor/meteor'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
// import * as withTracker from 'meteor/react-meteor-data';
import { withTracker } from '../lib/ReactMeteorData/react-meteor-data'
import Header from './Header.js'
import Dashboard from './Dashboard.js'
import SystemStatus from './SystemStatus.js'
import { RunningOrderList } from './RunningOrderList.js';
import { NymansPlayground } from '../ui/NymansPlayground'
import {
  BrowserRouter as Router,
  Route,
  Link
} from 'react-router-dom'

// App component - represents the whole app
class App extends React.Component {
	render () {

		// EXAMPLE IMPLEMENTATION of subscription
		//
		// Subscribe to data
		// Note: we should NOT call the subscription in this place, but instead move it into something handled by the router,
		// so the subscriptions are set/stopped when navigating between pages, or something.
		//
		let sub = Meteor.subscribe('peripheralDevices', {}, { // subscribe to ALL peripherals
			onReady () {
					// called when ready
			},
			onStop () {
					// called when stopped
			}
		})
		// Subscription status available at sub.ready()
		// Stop subscription by calling sub.stop()
		// TEMPORARY subscriptions:
		let sub2 = Meteor.subscribe('runningOrders', {})
		let sub3 = Meteor.subscribe('segments', {})
		let sub4 = Meteor.subscribe('segmentLines', {})
		let sub5 = Meteor.subscribe('segmentLineItems', {})

		return (
			<Router>
			<div className='container-fluid'>
				<Header />
				<Route exact path='/' component={Dashboard} />
				<Route exact path='/runningOrders' component={RunningOrderList} />
				<Route path='/nymansPlayground' component={NymansPlayground} />
				<Route path='/status' component={SystemStatus} />
			</div>
			</Router>
		)
	}
}

export default App
