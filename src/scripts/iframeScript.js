import { Component } from 'react';

export default class IframeComponent extends Component {
	constructor(props) {
		super(props);
        console.log(`in IframeComponent constructor START`);
		if (window.parent !== window) {
            console.log(`in IframeComponent constructor RUN`);
			this.tabReady = false;
			this.bc = new BroadcastChannel('walletconnect');
			this.setupListeners();
		}
        console.log(`in IframeComponent constructor END`);
	}

	setupListeners() {
		console.log(`in IframeComponent setupListeners() START`);
        //const tabDomain = 'link-to-production-server';
        const tabDomain = 'http://localhost:3000';

		// Open as IFRAME
		onmessage = async ({ data, source, origin }) => {
            //console.log(`in IframeComponent setupListeners() ONMESSAGE init`);
            //console.log(data);
			if (data.target === 'WC-IFRAME' && source === window.parent) {
                console.log(`in IframeComponent setupListeners() ONMESSAGE`);
                console.log(data);
				// Open WalletConnect app in new tab.
				const tab = this.openOnce(tabDomain, 'walletconnect-tab');

				tab.onbeforeunload = () => {
					console.log(`in IframeComponent setupListeners() CLOSINGTAB`);
					this.tabReady = false;
				};

				//if (!this.tabReady) {this.pingTab();}
				while (!this.tabReady) {
					console.log(`blocking`);
					await this.sleep(1000);
                    this.pingTab(); // debug
				}

				data.target = 'WC-TAB';
				this.bc.postMessage(data, '*');
                console.log(`in IframeComponent setupListeners() RELAY DATA TO TAB: `);
			}
		};

		this.bc.onmessage = ({ data, source }) => {
            console.log(`in IframeComponent setupListeners() bc.onmessage`);
            console.log(data);
            console.log(source);
			if (data.target === 'tab-status') {
				this.tabReady = data.ready;
			} else {
				this.sendMessageToExtension(data);
			}
		};
	}

	pingTab() {
        console.log(`in IframeComponent pingTab()`);
		this.bc.postMessage({ target: 'WC-TAB', action: 'walletconnect-connection-check' });
	}

	sendMessageToExtension(msg) {
        console.log(`in IframeComponent sendMessageToExtension()`);
        console.log(msg);
		window.parent.postMessage(msg, '*');
	}

	openOnce(url, target) {
		var winref = window.open('', target, '', true);

		// if the "target" window was just opened, change its url
		if (winref.location.href === 'about:blank') {
			winref.location.href = url;
		}
		winref.focus();
		return winref;
	}

	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	render() {
		return null;
	}
}
