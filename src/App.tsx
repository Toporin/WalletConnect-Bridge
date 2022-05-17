import * as React from "react";
import styled from "styled-components";
import WalletConnect from "@walletconnect/client";
import QRCodeModal from "@walletconnect/qrcode-modal";
import { IInternalEvent, ITxData } from "@walletconnect/types";

import Button from "./components/Button";
import Column from "./components/Column";
import Wrapper from "./components/Wrapper";
import Modal from "./components/Modal";
import Header from "./components/Header";
import Loader from "./components/Loader";
import { fonts } from "./styles";
import { IAssetData } from "./helpers/types";
import Banner from "./components/Banner";
// import { eip712 } from "./helpers/eip712";
import { hashTypedDataMessage } from "./helpers/utilities";
// this script is loaded by Metamask to relay message between Metamask and the bridge
import IframeScript from './scripts/iframeScript';

const SLayout = styled.div`
  position: relative;
  width: 100%;
  /* height: 100%; */
  min-height: 100vh;
  text-align: center;
`;

const SContent = styled(Wrapper as any)`
  width: 100%;
  height: 100%;
  padding: 0 16px;
`;

const SLanding = styled(Column as any)`
  height: 600px;
`;

const SButtonContainer = styled(Column as any)`
  width: 250px;
  margin: 50px 0;
`;

const SConnectButton = styled(Button as any)`
  border-radius: 8px;
  font-size: ${fonts.size.medium};
  height: 44px;
  width: 100%;
  margin: 12px 0;
`;

const SContainer = styled.div`
  height: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  word-break: break-word;
`;

const SModalContainer = styled.div`
  width: 100%;
  position: relative;
  word-wrap: break-word;
`;

const SModalTitle = styled.div`
  margin: 1em 0;
  font-size: 20px;
  font-weight: 700;
`;

const SModalParagraph = styled.p`
  margin-top: 30px;
`;

// @ts-ignore
const SBalances = styled(SLanding as any)`
  height: 100%;
  & h3 {
    padding-top: 30px;
  }
`;

const STable = styled(SContainer as any)`
  flex-direction: column;
  text-align: left;
`;

const SRow = styled.div`
  width: 100%;
  display: flex;
  margin: 6px 0;
`;

const SKey = styled.div`
  width: 30%;
  font-weight: 700;
`;

const SValue = styled.div`
  width: 70%;
  font-family: monospace;
`;

interface IAppState {
  connector: WalletConnect | null;
  fetching: boolean;
  connected: boolean;
  chainId: number;
  showModal: boolean;
  pendingRequest: boolean;
  uri: string;
  accounts: string[];
  address: string;
  result: any | null;
  assets: IAssetData[];
  bc: BroadcastChannel | null;
}

const INITIAL_STATE: IAppState = {
  connector: null,
  fetching: false,
  connected: false,
  chainId: 1,
  showModal: false,
  pendingRequest: false,
  uri: "",
  accounts: [],
  address: "",
  result: null,
  assets: [],
  bc: null,
};

interface IPayload {
  [key: string]: any;
};

console.log(`in App START FILE`);

class App extends React.Component<any, any> {
  public state: IAppState = {
    ...INITIAL_STATE,
  };

  public connect = async () => {
    console.log(`in App connect() START`);
    // bridge url
    const bridge = "https://bridge.walletconnect.org";

    // create new connector
    const connector = new WalletConnect({ bridge, qrcodeModal: QRCodeModal });

    await this.setState({ connector});

    // check if already connected
    if (!connector.connected) {
      // create new session
      await connector.createSession();
    }

    // subscribe to events
    await this.subscribeToEvents();

    // when openend in a new tab by Metamask (not as an iframe of Metamask)
    if (window.parent === window) {
        // walletconnect: broadcast channel between iframe and tab to relay messages between metamask and the bridge
        const bc= new BroadcastChannel('walletconnect');
        await this.setState({ bc});
        // subscribe to broadcastchannel events
        await this.subscribeToBroadcastChannelEvents();
    }
  };

  public subscribeToEvents = () => {
    console.log(`in App subscribeToEvents() START`);
    const { connector} = this.state;

    if (!connector) {
      return;
    }

    connector.on("session_update", async (error, payload) => {
      console.log(`connector.on("session_update")`);

      if (error) {
        throw error;
      }

      const { chainId, accounts } = payload.params[0];
      this.onSessionUpdate(accounts, chainId);
    });

    connector.on("connect", (error, payload) => {
      console.log(`connector.on("connect")`);

      if (error) {
        throw error;
      }

      this.onConnect(payload);
    });

    connector.on("disconnect", (error, payload) => {
      console.log(`connector.on("disconnect")`);

      if (error) {
        throw error;
      }

      this.onDisconnect();
    });

    if (connector.connected) {
      const { chainId, accounts } = connector;
      const address = accounts[0]; // "waiting for provider...";
      this.setState({
        connected: true,
        chainId,
        accounts,
        address,
      });
      this.onSessionUpdate(accounts, chainId);
    }

    this.setState({ connector });
  }; // end subscribeToEvents

  public subscribeToBroadcastChannelEvents = () => {
    console.log(`in App subscribeToBroadcastChannelEvents() START`);
    const { bc } = this.state;

    if (!bc) {
      return;
    }

    window.onbeforeunload = () => {
        console.log(`in App setUpListeners window.onbeforeunload`);
        bc.postMessage({ target: 'tab-status', ready: false });
    };

    bc.onmessage = async ({ data }) => {
        console.log(`in App subscribeToEvents bc.onmessage`);
        if (data && data.target === 'WC-TAB') { // todo rename
            console.log(data);
            const { action, params } = data;
            const replyAction = `${action}-reply`;
            await this.waitForConnection();
            switch (action) {
                case 'walletconnect-connection-check': // ping request
                    this.checkReadyForCommand();
                    break;
                case 'walletconnect-unlock':
                    this.unlock(replyAction, params.addrIndex);
                    break;
                case 'walletconnect-sign-transaction':
                    this.bcSignTransaction(replyAction, params.tx, params.address);
                    break;
                case 'walletconnect-sign-personal-message':
                    this.bcSignPersonalMessage(replyAction, params.message, params.address);
                    break;
                case 'walletconnect-sign-typed-data':
                    const payload= {typedData:params.typedData,
                                    domainSeparatorHex:params.domainSeparatorHex,
                                    hashStructMessageHex:params.hashStructMessageHex}
                    this.bcSignTypedData(replyAction, payload, params.address);
                    break;
                default:
                    this.sendMessageToIframe(replyAction, false, {error: 'Not supported' });
                    break;
            }
        }
    };

    this.setState({ bc });
  }; // end subscribeToBroadcastChannelEvents()

  /* BROADCAST CHANNEL functions */

  public waitForConnection = async () => {
		try {
            console.log(`in App waitForConnection()`);
            // TODO check for state.connected?
		} catch (e) {
			console.log('WC:::CONNECTION ERROR', e);
		}
  };

  public checkReadyForCommand = async () => {
        console.log(`in App checkReadyForCommand()`);
        const { connected, bc } = this.state;
        if (connected) {
			console.log(`in App checkReadyForCommand(): connected!`);
			if (bc){
                bc.postMessage({ target: 'tab-status', ready: true });
            }
		}
	};

    public unlock = async (replyAction: string, addrIndex: number) => {
        console.log(`in App unlock()`);
		try {
            // TODO: send request to walletconnect
            const { connected, accounts } = this.state;
            if (connected){
                // const res = {parentPublicKey:accounts[0], parentChainCode:accounts[1], bip32Path:accounts[2]}; // DONE: replace publickey with path?
                // const res = {parentPublicKey:accounts[0], parentChainCode:accounts[0], bip32Path:accounts[0]};
                const res = {accounts};
                this.sendMessageToIframe(replyAction, true, res);
                // TODO: compute address from addrIndex and accounts
            }
            else {
                this.sendMessageToIframe(replyAction, false, { error: "not connected!" });
            }
		} catch (err) {
			this.sendMessageToIframe(replyAction, false, { error: err.toString() });
		} finally {
			this.cleanUp();
		}
	};

    public bcSignTransaction= async (replyAction: string, tx: ITxData, address: string) => {
        console.log(`in App bcSignTransaction()`);
        console.log(replyAction);
        console.log(tx);
        console.log(address);
        this.setState({ address });
		try {
            const result= await this.wcSignTransaction(tx, address);
            console.log(`in App bcSignTransaction() result:`);
            console.log(result);
            if (result){
                this.sendMessageToIframe(replyAction, result.success, result.payload);
            } else {
                this.sendMessageToIframe(replyAction, false, {error: "unknown error"});
            }
		} catch (err) {
            console.log(`in App bcSignTransaction() error:`);
            console.log(err.toString());
			this.sendMessageToIframe(replyAction, false, { error: err.toString() });
		} finally {
			this.cleanUp();
		}
	};

    public bcSignPersonalMessage= async (replyAction:string, message:string, address:string) => {
        console.log(`in App bcSignPersonalMessage()`);
        console.log(replyAction);
        console.log(message);
        console.log(address);
        // this.setState({ address });
		try {
            const result= await this.wcSignPersonalMessage(message, address);
            console.log(`in App bcSignPersonalMessage() result=`);
            console.log(result);
            if (result){
                this.sendMessageToIframe(replyAction, result.success, result.payload);
            } else {
                this.sendMessageToIframe(replyAction, false, {error: "unknown error"});
            }
        } catch (err) {
        	this.sendMessageToIframe(replyAction, false, { error: err.toString() });
        } finally {
        	this.cleanUp();
        }
    };

    public bcSignTypedData= async (replyAction:string, payload: IPayload, address: string) =>{
        console.log(`in App bcSignPersonalMessage()`);
        console.log(replyAction);
        console.log(payload);
        console.log(address);
        this.setState({ address });
        try {
            const result= await this.wcSignTypedData(payload, address);
            console.log(`in App bcSignTypedData() result=`);
            console.log(result);
            if (result){
                this.sendMessageToIframe(replyAction, result.success, result.payload);
            } else {
                this.sendMessageToIframe(replyAction, false, {error: "unknown error"});
            }
        } catch (err) {
            this.sendMessageToIframe(replyAction, false, { error: err.toString() });
        } finally {
            this.cleanUp();
        }
    };

    public cleanUp= () => {
        console.log(`in App cleanUp()`);
    };

    public sendMessageToIframe = (action: string, success: boolean, payload: IPayload) => {
        console.log(`in App sendMessageToIframe()`);
        const { connected, bc } = this.state;
		if (connected && bc){
            bc.postMessage({ action, success, payload });
        }
	};

  /* WALLET CONNECT RPC */

  public wcSignTransaction = async (tx: ITxData, address: string) => {
    console.log(`in App wcSignTransaction() START`);
    console.log(`in App wcSignTransaction() tx=`);
    console.log(tx);
    // const { connector, address, chainId } = this.state;
    const { connector} = this.state;

    if (!connector) {
      return;
    }

    try {
      // open modal
      this.toggleModal();

      // toggle pending request indicator
      this.setState({ pendingRequest: true });

      // send transaction
      // WalletConnect implemented a passthrough for EIP1559 transactions: https://github.com/WalletConnect/walletconnect-monorepo/commit/01255d3b5138951df7947e52400f13e1c3c1dc01
      console.log(`in App wcSignTransaction() SEND WITH WC`);
      const result = await connector.signTransaction(tx);
      console.log(`in App wcSignTransaction() RESULT=`);
      console.log(result);

      // format displayed result
      const formattedResult = {
        method: "eth_signTransaction",
        from: address,
        to: (tx.to == null)? "null" : tx.to,
        value: `${tx.value} ETH`,
        result,
      };

      // display result
      this.setState({
        connector,
        pendingRequest: false,
        result: formattedResult || null,
      });

      // return result to calling method
      // return result;
      return {success:true, payload:{sig:result}}; // TOOD: rename payload:result to result:result or sig:result

    } catch (error) {
      console.error(error);
      // this.setState({ connector, pendingRequest: false, result: null });

       // format displayed result
      const formattedResult = {
        method: "eth_signTransaction",
        from: address,
        to: (tx.to == null)? "null" : tx.to,
        value: `${tx.value} ETH`,
        result: error.message,
      };

      // display result
      this.setState({
        connector,
        pendingRequest: false,
        result: formattedResult || null,
      });

      return {success:false, payload:{error:error.message}}; // TOOD: rename payload:result to result:result or sig:result

    }
  };

  public wcSignPersonalMessage = async (message: string, address: string) => {
    console.log(`in App wcSignPersonalMessage() START`);
    const { connector } = this.state;

    if (!connector) {
      return;
    }

    // eth_sign params
    const msgParams = [message, address];

    try {
      // open modal
      this.toggleModal();

      // toggle pending request indicator
      this.setState({ pendingRequest: true });

      // do check on client side?
      // if (address.toLowerCase() !== accounts[0].toLowerCase() ){
      //     throw new Error(`Address mismatch: Metamask sent ${address}, while WalletConnect expects ${accounts[0]}`);
      // }

      // send message
      const result = await connector.signPersonalMessage(msgParams);
      console.log(`in App wcSignPersonalMessage() RESULT:`);
      console.log(result);

      // verify signature
      // const hash = hashMessage(message);
      const valid = true; // TODO? await verifySignature(address, result, hash, chainId);
      console.log(`in App wcSignPersonalMessage() VALID? :`);
      console.log(valid);

      // format displayed result
      const formattedResult = {
        method: "personal_sign",
        address,
        valid,
        result,
      };

      // display result
      this.setState({
        connector,
        pendingRequest: false,
        result: formattedResult || null,
      });

      // return result to calling method
      // return result;
      return {success:true, payload:{sig:result}};

    } catch (error) {
      console.log(`in App wcSignPersonalMessage() ERROR:`);
      console.error(error);
      // this.setState({ connector, pendingRequest: false, result: null });

       // format displayed result
      const formattedResult = {
        method: "personal_sign",
        address,
        valid:false,
        result: error.message,
      };

      // display result
      this.setState({
        connector,
        pendingRequest: false,
        result: formattedResult || null,
      });

      return  {success:false, payload:{error:error.message}};
    }
  };

  public wcSignTypedData = async (payload: IPayload, address: string) => {
      console.log(`in App wcSignTypedData() START`);
      const { connector } = this.state;

      if (!connector) {
        return;
      }

      // eth_sign params
      // we also include domainSeparatorHex and hashStructMessageHex
      const message = JSON.stringify(payload);
      const msgParams = [address, message];

      try {
        // open modal
        this.toggleModal();

        // toggle pending request indicator
        this.setState({ pendingRequest: true });

        // sign typed data
        const result = await connector.signTypedData(msgParams);
        console.log(`in App wcSignTypedData() RESULT=`);
        console.log(result);

        // verify signature
        const typedData= payload.typedData
        const typedDataTxt= JSON.stringify(typedData);
        const hash = hashTypedDataMessage(typedDataTxt);
        console.log(`in App wcSignTypedData() HASH=`);
        console.log(hash);
        const valid = true; // TODO? await verifySignature(address, result, hash, chainId);
        console.log(`in App wcSignTypedData() VALID?`);
        console.log(valid);

        // format displayed result
        const formattedResult = {
          method: "eth_signTypedData",
          address,
          valid,
          result,
        };

        // display result
        this.setState({
          connector,
          pendingRequest: false,
          result: formattedResult || null,
        });

        // return result to calling method
        // return result;
        return {success:true, payload:{sig:result}};

      } catch (error) {
        console.log(`in App wcSignTypedData() ERROR:`);
        console.error(error);
        // this.setState({ connector, pendingRequest: false, result: null });

         // format displayed result
        const formattedResult = {
          method: "eth_signTypedData",
          address,
          valid:false,
          result: error.message,
        };

        // display result
        this.setState({
          connector,
          pendingRequest: false,
          result: formattedResult || null,
        });

        return  {success:false, payload:{error:error.message}};
      }
  };

  /* WALLET CONNECT functions */

  public killSession = async () => {
    console.log(`in App killSession() START`);
    const { connector } = this.state;
    if (connector) {
      connector.killSession();
    }
    this.resetApp();
  };

  public resetApp = async () => {
    console.log(`in App resetApp() START`);
    const { bc } = this.state;
    if (bc) {
      bc.postMessage({ target: 'tab-status', ready: false });
      bc.close();
    }
    await this.setState({ ...INITIAL_STATE });
  };

  public onConnect = async (payload: IInternalEvent) => {
    console.log(`in App onConnect() START`);
    const { chainId, accounts } = payload.params[0];
    const address = accounts[0]; // "waiting for provider...";
    console.log(`in App onConnect() chainId:`);
    console.log(chainId);
    console.log(`in App onConnect() accounts:`);
    console.log(accounts);
    await this.setState({
      connected: true,
      chainId,
      accounts,
      address,
    });
    // this.getAccountAssets();
  };

  public onDisconnect = async () => {
    console.log(`in App onDisconnect() START`);
    this.resetApp();
  };

  public onSessionUpdate = async (accounts: string[], chainId: number) => {
    console.log(`in App onSessionUpdate() START`);
    const address = accounts[0]; // do something?
    await this.setState({ chainId, accounts, address });
  };

  public toggleModal = () => this.setState({ showModal: !this.state.showModal });

  public render = () => {
    console.log(`in App render() START`);
    const {
      assets,
      address,
      connected,
      chainId,
      fetching,
      showModal,
      pendingRequest,
      result,
    } = this.state;
    return (
      <SLayout>
        <Column maxWidth={1000} spanHeight>
          <Header
            connected={connected}
            address={address}
            chainId={chainId}
            killSession={this.killSession}
          />
          <SContent>
            <IframeScript/>
            {!address && !assets.length ? (
              <SLanding center>
                <h3>
                  {`Welcome to WalletConnect-Bridge`}
                  <br />
                  <span>{`v${process.env.REACT_APP_VERSION}`}</span>
                </h3>
                <SButtonContainer>
                  <SConnectButton left onClick={this.connect} fetching={fetching}>
                    {"Connect to WalletConnect"}
                  </SConnectButton>
                </SButtonContainer>
              </SLanding>
            ) : (
              <SBalances>
                <Banner />
              </SBalances>
            )}
          </SContent>
        </Column>
        <Modal show={showModal} toggleModal={this.toggleModal}>
          {pendingRequest ? (
            <SModalContainer>
              <SModalTitle>{"Pending Call Request"}</SModalTitle>
              <SContainer>
                <Loader />
                <SModalParagraph>{"Approve or reject request using your wallet"}</SModalParagraph>
              </SContainer>
            </SModalContainer>
          ) : result ? (
            <SModalContainer>
              <SModalTitle>{"Call Request Approved"}</SModalTitle>
              <STable>
                {Object.keys(result).map(key => (
                  <SRow key={key}>
                    <SKey>{key}</SKey>
                    <SValue>{result[key].toString()}</SValue>
                  </SRow>
                ))}
              </STable>
            </SModalContainer>
          ) : (
            <SModalContainer>
              <SModalTitle>{"Call Request Rejected"}</SModalTitle>
            </SModalContainer>
          )}
        </Modal>
      </SLayout>
    );
  }; // render()
} // App class

console.log(`in App END FILE`);
export default App;
