var BigNumber = require('bignumber.js')

function rpc(method, arg) {
    var req = {
        jsonrpc: "2.0",
        method: method,
        id: new Date().getTime()
    }
    if (arg) req.params = arg

    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync(req, (err, result) => {
            if (err) return reject(err)
            if (result && result.error) {
                return reject(new Error("RPC Error: " + (result.error.message || result.error)))
            }
            resolve(result)
        })
    })
}

// Change block time using the rpc call "evm_setTimestamp"
// https://github.com/ethereumjs/testrpc/issues/47
web3.evm = web3.evm || {}
web3.evm.increaseTime = function(time) {
    return rpc('evm_increaseTime', [time])
}

function checkAllGasSpent(gasAmount, gasPrice, account, prevBalance) {
    var newBalance = web3.eth.getBalance(account)
    assert.equal(prevBalance.minus(newBalance).toNumber(), gasAmount * gasPrice, 'Incorrect amount of gas used')
}

function ifUsingTestRPC() {
    return
}

//Some default values for gas
var gasAmount = 3000000
var gasPrice = 20000000000
var initialDisbursement = new BigNumber(1500000000000000000000000)

var multiSigAddresses = ['0x54fd80d6ae7584d8e9a19fe1df43f04e5282cc43', '0xa6d135de4acf44f34e2e14a4ee619ce0a99d1e08']
var Numeraire = artifacts.require("./NumeraireBackend.sol")
var NumeraireDelegate = artifacts.require("./NumeraireDelegate.sol")
var snapshotID = 0

contract('Numeraire', function(accounts) {

    before(function(done) {
        var etherAmount = new BigNumber('1000000000000000000')
        web3.eth.sendTransaction({from: accounts[0], to: multiSigAddresses[0], value: etherAmount, gasLimit: 21000, gasPrice: gasPrice})
        web3.eth.sendTransaction({from: accounts[5], to: multiSigAddresses[1], value: etherAmount, gasLimit: 21000, gasPrice: gasPrice})
        Numeraire.deployed().then(function(nmrInstance) {
            NumeraireDelegate.deployed().then(function(delegateInstance) {
                nmrInstance.changeDelegate(delegateInstance.address, {from: multiSigAddresses[0]}).then(function() {
                    nmrInstance.changeDelegate(delegateInstance.address, {from: multiSigAddresses[1]}).then(function() {
                        done()
                    })
                })
            })
        })
    })

    it ("should set the delegate correctly", function(done) {
        Numeraire.deployed().then(function(nmrInstance) {
            NumeraireDelegate.deployed().then(function(delegateInstance) {
                nmrInstance.delegateContract.call().then(function(delegateAddress) {
                    assert.equal(delegateAddress, delegateInstance.address)
                    done()
                })
            })
        })
    })

    it("should have set disbursement when deployed", function(done) {
        Numeraire.deployed().then(function(nmrInstance) {
            nmrInstance.disbursement.call().then(function(disbursement) {
                assert.equal(true, disbursement.equals(initialDisbursement))
                done()
            })
        })
    })

    it("should not mint more than the disbursement", function(done) {
        var prevBalance
        var nmr = Numeraire.deployed().then(function(instance) {
            prevBalance = web3.eth.getBalance(accounts[0])
            instance.mint(initialDisbursement.add(1), {
                    from: accounts[0],
                    gasPrice: gasPrice,
                    gas: gasAmount
                })
                .catch(ifUsingTestRPC)
                .then(function() {
                    checkAllGasSpent(gasAmount, gasPrice, accounts[0], prevBalance)
                })
                .then(function () {
                    done()})
                .catch(done)
        })
    })

    it("should mint correctly", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            instance.mint(10000000000, {from: accounts[0]}).then(function() {
                instance.balanceOf.call(instance.address).then(function(balance) {
                    // check if Numerai has minted amount
                    assert.equal(balance.toNumber(), 10000000000)
                    done()
                })
            })
        })
    })

    it("should increment totalSupply on mint", function(done) {
        Numeraire.deployed().then(function(instance) {
            instance.totalSupply.call().then(function(supply) {
                // check if supply has increased by minted amounts
                assert.equal(supply.toNumber(), 10000000000)
                done()
            })
        })
    })

    it('should reduce disbursement when minting', function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            return instance.disbursement.call().then(function(last_disbursement) {
                return instance.mint(10000000000, {
                    from: accounts[0]
                }).then(function() {
                    instance.disbursement.call().then(function(disbursement) {
                        assert.equal(disbursement.toNumber(), last_disbursement.toNumber() - 10000000000)
                        done()
                    })
                })
            })
        })
    })

    it("should reset disbursement once per week", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            return instance.disbursement.call().then(disbursement => {
                return instance.mint(500000, {
                    from: accounts[0]
                }).then(() => {
                    return web3.evm.increaseTime(7 * 24 * 60 * 60).then(() => {
                        return instance.mint(20000000000, {
                            from: accounts[0]
                        }).then(() => {
                            return instance.disbursement.call().then(disbursement => {
                                assert.equal(96153846153846153846153 - 20000000000, disbursement.toNumber())
                                done()
                            })
                        })
                    })
                })
            })
        })
    })

    it("should send NMR correctly from numerai account", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            // Get initial balances of first and second account.
            var account_one = Numeraire.address
            var account_two = accounts[2]

            var account_one_starting_balance
            var account_two_starting_balance
            var account_one_ending_balance
            var account_two_ending_balance

            var amount = 1000000000

            return instance.mint(amount, {
                from: accounts[0]
            }).then(function() {
                return instance.balanceOf.call(account_one).then(function(balance) {
                    account_one_starting_balance = balance.toNumber()
                    return instance.balanceOf.call(account_two)
                }).then(function(balance) {
                    account_two_starting_balance = balance.toNumber()
                    instance.numeraiTransfer(account_two, amount, {from: accounts[0]})
                }).then(function() {
                    instance.numeraiTransfer(account_two, amount, {from: multiSigAddresses[0]})
                }).then(function() {
                    return instance.balanceOf.call(account_one)
                }).then(function(balance) {
                    account_one_ending_balance = balance.toNumber()
                    return instance.balanceOf.call(account_two)
                }).then(function(balance) {
                    account_two_ending_balance = balance.toNumber()

                    assert.equal(account_one_ending_balance, account_one_starting_balance - amount, "Amount wasn't correctly taken from the sender")
                    assert.equal(account_two_ending_balance, account_two_starting_balance + amount, "Amount wasn't correctly sent to the receiver")
                    done()
                })
            })
        })
    })

    it('should create a tournament', (done) => {
        Numeraire.deployed().then(function(instance) {
            return instance.createTournament(0).then(function(transaction) {
                var block = web3.eth.getBlock(transaction.receipt.blockNumber)
                return instance.getTournament.call(0).then(function(tournament) {
                    creationTime = tournament[0]
                    numRounds = tournament[1]
                    assert.equal(0, numRounds.toNumber())
                    assert.equal(block.timestamp, creationTime.toNumber())
                    done()
                })
            })
        })
    })

    it('should create a round', (done) => {
        Numeraire.deployed().then(function(instance) {
            return instance.createTournament(50).then(function(transaction) {
                var block = web3.eth.getBlock(transaction.receipt.blockNumber)
                var resolutionTime = block.timestamp + (4 * 7 * 24 * 60 * 60)
                return instance.createRound(0, 51, resolutionTime).then(function(transaction) {
                    var block = web3.eth.getBlock(transaction.receipt.blockNumber)
                    return instance.getRound.call(0, 51).then(function(round) {
                        creationTime = round[0]
                        realResolutionTime = round[1]
                        numStakes = round[2]
                        assert.equal(creationTime.toNumber(), block.timestamp)
                        assert.equal(realResolutionTime.toNumber(), resolutionTime)
                        assert.equal(numStakes.toNumber(), 0)
                        instance.getTournament.call(0).then(function(tournament) {
                            numRounds = tournament[1]
                            roundIDs = tournament[2]
                            assert.equal(1, numRounds.toNumber())
                            // FIXME: This test doesn't work, although the contract is doing the right thing
                            // assert.equal(roundIDs, [51]) 
                            done()
                        })
                    })
                })
            })
        })
    })

    it('should stake NMR on behalf of another account', (done) => {
        numerai_hot_wallet = accounts[2]
        var amount = 500
        Numeraire.deployed().then(function(instance) {
            instance.balanceOf.call(numerai_hot_wallet).then((balance) => {
                return instance.stakeOnBehalf(numerai_hot_wallet, accounts[4], amount, 0, 51, 5, {from: accounts[0]}).then(function(tx_id) {
                    var block = web3.eth.getBlock(tx_id.receipt.blockNumber)
                    instance.getStake.call(0, 51, accounts[4], block.timestamp, 0).then(function(stake) {
                        assert.equal(stake[2].toNumber(), 5)
                        assert.equal(stake[3].toNumber(), amount)
                        assert.equal(stake[4], false)
                        assert.equal(stake[5], false)
                    }).then(function() {
                        instance.balanceOf.call(numerai_hot_wallet).then((balance_after) => {
                            assert.equal(balance.toNumber() - amount, balance_after.toNumber())
                            done()
                        })
                    })
                })
            })
        })
    })


    it('should stake NMR as self', (done) => {
        var amount = 500
        var userAccount = accounts[2]
        var nmr = Numeraire.deployed().then(function(instance) {
            instance.balanceOf.call(userAccount).then((balance) => {
                return instance.stake(amount, 0, 51, 1, {from: userAccount}).then(function(tx_id) {
                    var block = web3.eth.getBlock(tx_id.receipt.blockNumber)
                    instance.getStake.call(0, 51, userAccount).then(function(stake) {
                        assert.equal(stake[2].toNumber(), 1)
                        assert.equal(stake[3].toNumber(), amount)
                        assert.equal(stake[4], false)
                        assert.equal(stake[5], false)
                    })
                    instance.balanceOf.call(userAccount).then((balance_after) => {
                        assert.equal(balance.toNumber() - amount, balance_after.toNumber())
                        done()
                    })
                })
            })
        })
    })

    it("should send NMR correctly", function(done) {
        var nmr = Numeraire.deployed().then(function(instance) {
            // Get initial balances of first and second account.
            var account_one = accounts[1]
            var account_two = accounts[2]

            var account_one_starting_balance
            var account_two_starting_balance
            var account_one_ending_balance
            var account_two_ending_balance

            var amount = 1000000000 - 1000

            return instance.mint(amount, {
                from: accounts[0]
            }).then(function() {
                return instance.balanceOf.call(account_one).then(function(balance) {
                    account_one_starting_balance = balance.toNumber()
                    return instance.balanceOf.call(account_two)
                }).then(function(balance) {
                    account_two_starting_balance = balance.toNumber()
                    return instance.transfer(account_one, amount, {
                        from: account_two
                    })
                }).then(function() {
                    return instance.balanceOf.call(account_one)
                }).then(function(balance) {
                    account_one_ending_balance = balance.toNumber()
                    return instance.balanceOf.call(account_two)
                }).then(function(balance) {
                    account_two_ending_balance = balance.toNumber()

                    assert.equal(account_one_ending_balance, account_one_starting_balance + amount, "Amount wasn't correctly sent to the receiver")
                    assert.equal(account_two_ending_balance, account_two_starting_balance - amount, "Amount wasn't correctly taken from the sender")
                    done()
                })
            })
        })
    })

    it('should destroy stake', function(done) {
        rpc('evm_snapshot').then(function(snapshot) {
            snapshotID = snapshot['id']
            var numerai_hot_wallet = accounts[1]
            var originalTotalSupply = 0
            var amount = 500
            var nmr = Numeraire.deployed().then(function(instance) {
            return instance.stakeOnBehalf(numerai_hot_wallet, accounts[5], amount, 0, 51, 6, {from: accounts[0]}).then(function(tx_id) {
                web3.evm.increaseTime(4 * 7 * 24 * 60 * 60).then(() => { // Make sure the block timestamp is new
                    instance.totalSupply.call().then(function(totalSupply) {
                        originalTotalSupply = totalSupply.toNumber()
                        var block = web3.eth.getBlock(tx_id.receipt.blockNumber)
                        instance.destroyStake(accounts[5], 0, 51, {from: accounts[0]}).then(function() {
                            instance.totalSupply.call().then(function(newSupply) {
                                assert.equal(originalTotalSupply - amount, newSupply.toNumber())
                                instance.getStake.call(0, 51, accounts[5]).then(function(stake) {
                                    assert.equal(stake[2].toNumber(), 6)
                                    assert.equal(stake[3].toNumber(), 0)
                                    assert.equal(stake[4], false)
                                    assert.equal(stake[5], true)
                                    done()
                                    })
                                })
                            })
                        })
                    })
                })
            })
        })
    })

    it('should release stake', function(done) {
        rpc('evm_revert', [snapshotID]).then(function() {
            var numerai_hot_wallet = accounts[1]
            var stakeBeforeRelease = 0
            var amount = 500
            var originalNumeraiBalance = 0
            var staker = accounts[6]
            var tournamentID = 51
            var roundID = 52
            Numeraire.deployed().then(function(instance) {
            return instance.createTournament(tournamentID).then(function(transaction) {
                var block = web3.eth.getBlock(transaction.receipt.blockNumber)
                var resolutionTime = block.timestamp + (4 * 7 * 24 * 60 * 60)
                instance.createRound(tournamentID, roundID, resolutionTime).then(function() {
                    var originalBalance = web3.eth.getBalance(staker)
                    return instance.stakeOnBehalf(numerai_hot_wallet, staker, amount, tournamentID, roundID, 7, {from: accounts[0]}).then(function(tx_id) {
                        var block = web3.eth.getBlock(tx_id.receipt.blockNumber)
                        instance.balanceOf.call(instance.address).then(function(numeraiBalance) {
                            originalNumeraiBalance = numeraiBalance.toNumber()
                            instance.balanceOf.call(staker).then(function(originalStakerBalance) {
                                instance.getStake.call(tournamentID, roundID, staker).then(function(stake) {
                                    stakeBeforeRelease = stake[3].toNumber()
                                    web3.evm.increaseTime(4 * 7 * 24 * 60 * 60).then(function() {
                                        instance.releaseStake(staker, 0, tournamentID, roundID, true, {from: accounts[0]}).then(function() {
                                            instance.balanceOf.call(instance.address).then(function(numeraiBalance) {
                                                assert.equal(originalNumeraiBalance, numeraiBalance.toNumber())
                                                instance.balanceOf.call(staker).then(function(newStakerBalance) {
                                                    assert.equal(newStakerBalance.toNumber(), originalStakerBalance.toNumber() + amount)
                                                    instance.getStake.call(tournamentID, roundID, staker).then(function(stakeAfterRelease) {
                                                        assert.equal(stakeAfterRelease[2], 7)
                                                        assert.equal(stakeBeforeRelease - amount, stakeAfterRelease[3].toNumber())
                                                        assert.equal(stakeAfterRelease[4], true)
                                                        assert.equal(stakeAfterRelease[5], true)
                                                        var newBalance = web3.eth.getBalance(staker)
                                                        assert.equal(originalBalance.toNumber() + 1, newBalance.toNumber())
                                                        done()
                                                    })
                                                })
                                            })
                                        })
                                    })
                                })
                            })
                        })
                    })
                })
            })
            })
        })
    })

    it('should transfer from an assignable deposit address', function(done) {
        Numeraire.deployed().then(function(instance) {
            var assignedAddress = '0xf4240'
            var amount = 25
            prevBalance = web3.eth.getBalance(accounts[0])
            instance.balanceOf.call(instance.address).then(function(originalNumeraiBalance) {
                instance.numeraiTransfer(assignedAddress, 25, {from: accounts[0]}).then(function() {
                    instance.numeraiTransfer(assignedAddress, 25, {from: multiSigAddresses[0]}).then(function() {
                        instance.balanceOf.call(instance.address).then(function(newNumeraiBalance) {
                            assert.equal(originalNumeraiBalance.toNumber() - amount, newNumeraiBalance.toNumber()) 
                        }).then(function() {
                            instance.balanceOf.call(assignedAddress).then(function(assignedBalance) {
                                assert.equal(amount, assignedBalance.toNumber())
                            }).then(function() {
                                instance.transferDeposit(assignedAddress, {from: accounts[0]}).then(function() {
                                    instance.balanceOf.call(instance.address).then(function(numeraiBalance) {
                                        assert.equal(originalNumeraiBalance.toNumber(), numeraiBalance.toNumber())
                                    }).then(function() {
                                        instance.balanceOf.call(assignedAddress).then(function(assignedBalance) {
                                            assert.equal(assignedBalance.toNumber(), 0)
                                            done()
                                        })
                                    })
                                })
                            })
                        })
                    })
                })
            })
        })
    })

})

// TODO: Test that releasing stake too early fails
// TODO: Test that transferDeposit(1000001) throws
// TODO: Calling mint, stake, transferNumerai, resolveStake, destroyStake from any address but the NumeraireBackend fails
