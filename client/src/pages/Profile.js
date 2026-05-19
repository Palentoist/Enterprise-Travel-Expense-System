"use client"

import { useState, useEffect } from "react"
import { UserCircleIcon, PencilIcon, CheckIcon, XMarkIcon } from "@heroicons/react/24/outline"
import { useAuth } from "../contexts/AuthContext"
import toast from "react-hot-toast"
import axios from "axios"

const Profile = () => {
  const { user, loadUser } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    department: user?.department || "",
    currentPassword: "",
    newPassword: "",
  })
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "" })
  const [changingPassword, setChangingPassword] = useState(false)
  const [stats, setStats] = useState({
    travelRequests: 0,
    expenseClaims: 0,
    totalExpenses: 0,
  })
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(null)

  useEffect(() => {
    const fetchStats = async () => {
      setStatsLoading(true)
      setStatsError(null)
      try {
        const [travelRes, expenseRes] = await Promise.all([
          axios.get("/api/travel", { params: { employee: user.id } }),
          axios.get("/api/expense", { params: { employee: user.id } }),
        ])
        setStats({
          travelRequests: travelRes.data.travelRequests.length,
          expenseClaims: expenseRes.data.expenseClaims.length,
          totalExpenses: expenseRes.data.expenseClaims.reduce((sum, claim) => sum + (claim.amount || 0), 0),
        })
      } catch (err) {
        setStatsError("Failed to load statistics")
      } finally {
        setStatsLoading(false)
      }
    }
    if (user?.id) fetchStats()
  }, [user?.id])

  const handleEdit = () => {
    setIsEditing(true)
    setFormData({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      department: user?.department || "",
      currentPassword: "",
      newPassword: "",
    })
  }

  const handleCancel = () => {
    setIsEditing(false)
    setFormData({
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      department: user?.department || "",
      currentPassword: "",
      newPassword: "",
    })
  }

  const handleSave = async () => {
    try {
      await axios.patch("/api/auth/profile", formData)
      toast.success("Profile updated successfully!")
      setIsEditing(false)
      await loadUser()
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update profile")
    }
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setChangingPassword(true)
    try {
      await axios.post("/api/auth/change-password", passwordData)
      toast.success("Password changed successfully!")
      setPasswordData({ currentPassword: "", newPassword: "" })
      setShowPasswordForm(false)
      await loadUser()
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to change password")
    } finally {
      setChangingPassword(false)
    }
  }



  const getRoleBadgeColor = (role) => {
    switch (role) {
      case "Admin":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      case "Manager":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "Employee":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  // Helper to format date
  const formatDate = (dateStr) => {
    if (!dateStr) return "Never"
    const date = new Date(dateStr)
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const year = date.getFullYear()
    return `${day}/${month}/${year}`
  }

  const getPasswordStrength = (password) => {
    let score = 0
    if (password.length >= 8) score++
    if (/[A-Z]/.test(password)) score++
    if (/[a-z]/.test(password)) score++
    if (/[0-9]/.test(password)) score++
    if (/[^A-Za-z0-9]/.test(password)) score++
    if (score <= 2) return { label: "Weak", color: "bg-red-500" }
    if (score === 3 || score === 4) return { label: "Medium", color: "bg-yellow-500" }
    return { label: "Strong", color: "bg-green-500" }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Manage your account information</p>
        </div>
      </div>

      {/* Profile Card */}
      <div className="card">
        <div className="card-header">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Personal Information</h3>
            {!isEditing ? (
              <button onClick={handleEdit} className="btn-secondary flex items-center">
                <PencilIcon className="h-4 w-4 mr-2" />
                Edit
              </button>
            ) : (
              <div className="flex space-x-2">
                <button onClick={handleSave} className="btn-success flex items-center">
                  <CheckIcon className="h-4 w-4 mr-2" />
                  Save
                </button>
                <button onClick={handleCancel} className="btn-secondary flex items-center">
                  <XMarkIcon className="h-4 w-4 mr-2" />
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="card-body">
          <div className="flex items-center space-x-6 mb-8">
            {/* Profile Picture Section */}
            <div className="flex-shrink-0 relative">
              <div className="w-20 h-20 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-full flex items-center justify-center shadow-strong text-white text-2xl font-bold uppercase">
                {user?.firstName && user?.lastName ? `${user.firstName[0]}${user.lastName[0]}` : <UserCircleIcon className="w-12 h-12 text-white" />}
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                {user?.firstName} {user?.lastName}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">@{user?.email}</p>
              <div className="mt-2">
                <span className={`badge ${getRoleBadgeColor(user?.role)}`}>{user?.role}</span>
              </div>
            </div>
          </div>

          <form className="grid grid-cols-1 md:grid-cols-2 gap-6" onSubmit={e => { e.preventDefault(); handleSave(); }}>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
              {isEditing ? (
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="input-field"
                />
              ) : (
                <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                  {user?.firstName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
              {isEditing ? (
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  className="input-field"
                />
              ) : (
                <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                  {user?.lastName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                {user?.email}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Email cannot be changed</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                {user?.role}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Role is managed by administrators</p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              {isEditing ? (
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  className="input-field"
                />
              ) : (
                <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 px-3 py-2 rounded-lg">
                  {user?.department}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Account Statistics */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Account Statistics</h3>
        </div>
        <div className="card-body">
          {statsLoading ? (
            <div className="flex justify-center items-center py-8">
              <span className="loading-spinner-large"></span>
            </div>
          ) : statsError ? (
            <div className="text-center text-red-500 py-8">{statsError}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">{stats.travelRequests}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Travel Requests</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.expenseClaims}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Expense Claims</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">${stats.totalExpenses.toLocaleString()}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Expenses</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Security Section */}
      <div className="card">
        <div className="card-header">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Security</h3>
        </div>
        <div className="card-body">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Password</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">Last updated: {formatDate(user?.passwordUpdatedAt)}</p>
              </div>
              <button className="btn-secondary" onClick={() => setShowPasswordForm(true)}>Change Password</button>
            </div>
            {showPasswordForm && (
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Password</label>
                    <input
                      type="password"
                      name="currentPassword"
                      value={passwordData.currentPassword}
                      onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
                    <input
                      type="password"
                      name="newPassword"
                      value={passwordData.newPassword}
                      onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                      className="input-field"
                      required
                      minLength={6}
                    />
                  </div>
                  {passwordData.newPassword && (
                    <div className="mt-2 flex items-center space-x-2">
                      <div className={`h-2 w-24 rounded ${getPasswordStrength(passwordData.newPassword).color}`}></div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{getPasswordStrength(passwordData.newPassword).label}</span>
                    </div>
                  )}
                  <div className="flex space-x-2">
                    <button type="submit" className="btn-primary" disabled={changingPassword}>
                      {changingPassword ? "Changing..." : "Change Password"}
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setShowPasswordForm(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">Account Status</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">Your account is active</p>
              </div>
              <span className="badge badge-approved">Active</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export default Profile
