import { CrocContext } from "./context";
import { Contract, BigNumber, ethers } from "ethers";
import { TransactionResponse } from "@ethersproject/providers";
import { AddressZero } from "@ethersproject/constants";
import { MAX_LIQ } from "./constants";
import { toDisplayQty, fromDisplayQty } from "./utils/token";

// Convention where token quantities can be repesented either as BigNumbers, indicating that it's
// the full wei value. *OR* can be represented as strings/numbers, indicating that the quantity
// represents a decimal norm'ed value. E.g. 1 ETH could either be 1.0, "1.0" or BigNumber(10).pow(10)
export type TokenQty = BigNumber | string | number;

export class CrocTokenView {
  constructor(context: Promise<CrocContext>, tokenAddr: string) {
    this.context = context;
    this.tokenAddr = tokenAddr;
    this.isNativeEth = tokenAddr == AddressZero;
    if (this.isNativeEth) {
      this.decimals = Promise.resolve(18);
    } else {
      this.decimals = this.resolve().then((c) => c.decimals());
    }
  }

  async approve(): Promise<TransactionResponse | undefined> {
    if (this.isNativeEth) {
      return undefined;
    }
    const weiQty = BigNumber.from(2).pow(120); // Lots of 0 bytes in calldata to save gas
    return (await this.resolve()).approve(
      (await this.context).dex.address,
      weiQty
    );
  }

  async wallet (address: string): Promise<BigNumber> {
    if (this.isNativeEth) {
      return (await this.context).provider.getBalance(address);
    } else {
      return (await this.resolve()).balanceOf(address);
    }
  }

  async walletDisplay (address: string): Promise<string> {
    let balance = this.balance(address);
    return toDisplayQty(await balance, await this.decimals);
  }

  async balance (address: string): Promise<BigNumber> {
    return (await this.context).query.querySurplus(address, this.tokenAddr)
  }

  async balanceDisplay (address: string): Promise<string> {
    let balance = this.balance(address);
    return toDisplayQty(await balance, await this.decimals);
  }

  async allowance(address: string): Promise<BigNumber> {
    if (this.isNativeEth) {
      return MAX_LIQ;
    }
    return (await this.resolve()).allowance(
      address,
      (await this.context).dex.address
    );
  }

  async normQty(qty: TokenQty): Promise<BigNumber> {
    if (typeof qty === "number" || typeof qty === "string") {
      return fromDisplayQty(qty.toString(), await this.decimals);
    } else {
      return qty;
    }
  }

  async toDisplay(qty: TokenQty): Promise<string> {
    if (typeof qty === "number" || typeof qty === "string") {
      return qty.toString();
    } else {
      return toDisplayQty(qty, await this.decimals);
    }
  }

  private async resolve(): Promise<Contract> {
    return (await this.context).erc20.attach(this.tokenAddr);
  }

  async deposit (qty: TokenQty, recv: string): Promise<TransactionResponse> {
    return this.surplusOp(73, qty, recv, this.isNativeEth)
  }

  async withdraw (qty: TokenQty, recv: string): Promise<TransactionResponse> {
    return this.surplusOp(74, qty, recv)
  }

  async transfer (qty: TokenQty, recv: string): Promise<TransactionResponse> {
    return this.surplusOp(75, qty, recv)
  }

  private async surplusOp (subCode: number, qty: TokenQty, recv: string, 
    useMsgVal: boolean = false): Promise<TransactionResponse> {
      let abiCoder = new ethers.utils.AbiCoder()
      let weiQty = this.normQty(qty)
      let cmd = abiCoder.encode(["uint8", "address", "uint128", "address"],
        [subCode, recv, await weiQty, this.tokenAddr])
  
      let txArgs = useMsgVal ? { value: await weiQty } : { }
      return (await this.context).dex.userCmd(COLD_PROXY_PATH, cmd, txArgs)
  
  }

  readonly tokenAddr: string;
  readonly context: Promise<CrocContext>;
  readonly decimals: Promise<number>;
  readonly isNativeEth: boolean;
}

const COLD_PROXY_PATH = 0