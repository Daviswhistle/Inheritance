// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice claim()/ownerWithdrawWLD() 를 호출하며 다시 vault 로 재진입을 시도하는 토큰.
/// @dev vault 의 nonReentrant 가 실제로 동작하는지 검증하기 위한 악성 토큰.
///      재진입 시도는 실패하지만, 이를 삼킨 뒤 "성공한 것처럼" 반환하려 한다.
///     즉 이 토큰은 표면상 정상이나, guard 없이는 자금이 두 번 빠져나간다.
interface IVaultReentry {
    function claim() external;

    function ownerWithdrawWLD(uint256 amount, address to) external;
}

contract MockERC20Reentrant {
    address public vault;
    bool public attackEnabled;
    uint256 public reentryAttempts;

    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function arm(address _vault) external {
        vault = _vault;
        attackEnabled = true;
    }

    function disarm() external {
        attackEnabled = false;
    }

    /// @dev 정상 토큰이므로 bool 을 반환해야 vault 가 정상 경로로 진행한다.
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        unchecked {
            balanceOf[msg.sender] -= amount;
        }
        balanceOf[to] += amount;

        if (attackEnabled && msg.sender == vault) {
            reentryAttempts += 1;
            IVaultReentry v = IVaultReentry(vault);
            try v.claim() {
                // 재진입에 성공했다면 이미 자금이 빠져나간 상태다.
            } catch {
                // guard 가 정상 동작했다.
            }
            try v.ownerWithdrawWLD(amount, to) {
                // 위와 동일하게 실패하면 무시한다.
            } catch {}
        }
        return true;
    }
}
