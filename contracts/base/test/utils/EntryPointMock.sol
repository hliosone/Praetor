// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// Records paymaster deposits; unit tests only (fork tests use the real EntryPoint v0.7).
contract EntryPointMock {
    mapping(address => uint256) public balanceOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function withdrawTo(address payable to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        to.transfer(amount);
    }
}
