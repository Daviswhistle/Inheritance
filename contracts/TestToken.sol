// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract TestToken {
    string public name="TestToken"; string public symbol="TT";
    uint8 public decimals=18; uint256 public totalSupply;
    mapping(address=>uint256) public balanceOf;
    event Transfer(address indexed from,address indexed to,uint256 value);
    constructor(uint256 initial) { balanceOf[msg.sender]=initial; totalSupply=initial; emit Transfer(address(0), msg.sender, initial); }
    function transfer(address to,uint256 v) external returns(bool){
        require(balanceOf[msg.sender]>=v,"bal");
        unchecked{balanceOf[msg.sender]-=v; balanceOf[to]+=v;}
        emit Transfer(msg.sender,to,v); return true;
    }
}
